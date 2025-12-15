require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const admin = require("firebase-admin");
// node-fetch v3 is ESM; use a tiny wrapper so fetch works in CommonJS
const fetch = (...args) => import("node-fetch").then(({ default: fetchFn }) => fetchFn(...args));
//const serviceAccount = require("./config/serviceAccountKey.json");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);


admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  projectId: serviceAccount.project_id,
});

const { getStorage } = require("firebase-admin/storage");
const bucket = getStorage().bucket();

const db = admin.firestore();
const app = express();

// CORS configuration - allow both production and local development
const allowedOrigins = [
  "https://stage-ghofrane.web.app", // production
  "http://localhost:3000" // local development
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ["GET", "POST", "DELETE", "PUT"],
  credentials: true
}));
app.use(bodyParser.json({ limit: "100mb" })); // allow larger payloads for up to 10 images in base64
app.use(bodyParser.urlencoded({ limit: "100mb", extended: true }));

const SECRET_KEY = process.env.SECRET_KEY || "supersecret";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const MAX_IMAGES = 4;
const clampNumberOfImages = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(Math.max(Math.round(numeric), 1), MAX_IMAGES);
};

/**
 * Sleep utility for delays between retries
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reduce base64 image size - simple approach
 * Note: Truncation can corrupt images. For production, use sharp library for proper compression.
 * @param {string} base64Data base64 string without data: prefix
 * @param {number} maxSizeKB maximum size in KB
 * @returns {string} base64 string
 */
const compressBase64Image = async (base64Data, maxSizeKB = 200) => {
  const sizeKB = (base64Data.length * 3) / 4 / 1024;
  if (sizeKB <= maxSizeKB) {
    console.log(`Image size OK: ${sizeKB.toFixed(2)}KB`);
    return base64Data;
  }
  
  // Calculate max length for target size (keep it divisible by 4 for base64 padding)
  const maxLength = Math.floor((maxSizeKB * 1024 * 4) / 3);
  const truncated = base64Data.substring(0, maxLength - (maxLength % 4));
  
  console.log(`Image too large: ${sizeKB.toFixed(2)}KB, truncated to ~${maxSizeKB}KB (WARNING: may corrupt image)`);
  console.log(`For better results, compress images on frontend before upload or use sharp library`);
  
  return truncated;
};

/**
 * Call Gemini image endpoint and return base64 data URLs (simple version for auto mode).
 * @param {string} finalPrompt
 * @param {string[]} photos base64 without data: prefix
 * @param {number} numberOfImages 1..4
 */
const generateImagesWithGeminiSimple = async (finalPrompt, photos, numberOfImages) => {
  const generateSingleImage = async () => {
    let lastError;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent?key=${process.env.GOOGLE_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { text: finalPrompt },
                    ...photos.map((p) => ({
                      inline_data: {
                        mime_type: "image/png", // assume PNG base64
                        data: p,
                      },
                    })),
                  ],
                },
              ],
            }),
          }
        );

        const data = await response.json();
        console.log("Gemini response:", JSON.stringify(data, null, 2));

        if (data.error) {
          throw new Error(data.error.message || "Generation failed");
        }

        const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
        let imageUrl = null;

        for (const cand of candidates) {
          const parts = cand?.content?.parts || [];
          for (const part of parts) {
            const inlineData = part?.inline_data || part?.inlineData;
            if (inlineData?.data) {
              const mime = inlineData?.mime_type || inlineData?.mimeType || "image/png";
              imageUrl = `data:${mime};base64,${inlineData.data}`;
              break;
            }
            if (typeof part?.text === "string" && part.text.startsWith("data:image/")) {
              imageUrl = part.text;
              break;
            }
          }
          if (imageUrl) break;
        }

        if (!imageUrl) {
          throw new Error("No image found in response");
        }

        return imageUrl;
      } catch (err) {
        lastError = err;
        console.warn(`Gemini attempt ${attempt} failed:`, err?.message || err);
        // try again if we have retries left
      }
    }
    throw lastError || new Error("Image generation failed");
  };

  const safeCount = clampNumberOfImages(numberOfImages);
  const imagePromises = Array.from({ length: safeCount }, () => generateSingleImage());
  return Promise.all(imagePromises);
};

/**
 * Call Gemini image endpoint and return base64 data URLs (with compression and delays for large photo sets).
 * @param {string} finalPrompt
 * @param {string[]} photos base64 without data: prefix
 * @param {number} numberOfImages 1..4
 * @param {number} maxPhotosToSend maximum number of photos to send to Gemini (default: all photos)
 */
const generateImagesWithGemini = async (finalPrompt, photos, numberOfImages, maxPhotosToSend = null) => {
  const generateSingleImage = async () => {
    let lastError;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        // Add delay between retries
        if (attempt > 1) {
          console.log(`Waiting 5 seconds before retry attempt ${attempt}...`);
          await sleep(5000);
        }
        
        // Compress photos to reduce processing time and avoid timeouts
        const compressedPhotos = await Promise.all(
          photos.map(p => compressBase64Image(p, 150)) // Reduced to 150KB
        );
        
        // Limit photos if maxPhotosToSend is specified, otherwise send all
        const photosToSend = maxPhotosToSend 
          ? compressedPhotos.slice(0, maxPhotosToSend)
          : compressedPhotos;
        console.log(`Attempt ${attempt}: Sending ${photosToSend.length} photo(s) to Gemini (${photos.length} total provided, max: ${maxPhotosToSend || 'all'})`);
        
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent?key=${process.env.GOOGLE_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { 
                      text: finalPrompt
                    },
                    ...photosToSend.map((p) => ({
                      inline_data: {
                        mime_type: "image/png", // assume PNG
                        data: p,
                      },
                    })),
                  ],
                },
              ],
            }),
          }
        );

        const data = await response.json();
        console.log("Gemini response:", JSON.stringify(data, null, 2));

        if (data.error) {
          throw new Error(data.error.message || "Generation failed");
        }

        const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
        let imageUrl = null;

        for (const cand of candidates) {
          // Check finishReason to understand why image wasn't generated
          if (cand?.finishReason && cand.finishReason !== "STOP") {
            const reason = cand.finishReason;
            const message = cand?.finishMessage || `Finish reason: ${reason}`;
            console.warn(`Gemini finishReason: ${reason}, message: ${message}`);
            
            // If it's a content filter or safety issue, try with a simpler prompt
            if (reason === "SAFETY" || reason === "RECITATION" || reason === "IMAGE_OTHER") {
              throw new Error(`Gemini blocked generation: ${message}`);
            }
          }
          
          const parts = cand?.content?.parts || [];
          for (const part of parts) {
            const inlineData = part?.inline_data || part?.inlineData;
            if (inlineData?.data) {
              const mime = inlineData?.mime_type || inlineData?.mimeType || "image/png";
              imageUrl = `data:${mime};base64,${inlineData.data}`;
              break;
            }
            if (typeof part?.text === "string" && part.text.startsWith("data:image/")) {
              imageUrl = part.text;
              break;
            }
          }
          if (imageUrl) break;
        }

        if (!imageUrl) {
          // Check if there's a finishMessage that explains the issue
          const finishMessage = candidates[0]?.finishMessage || "Unknown error";
          throw new Error(`No image found in response. ${finishMessage}`);
        }

        return imageUrl;
      } catch (err) {
        lastError = err;
        console.warn(`Gemini attempt ${attempt} failed:`, err?.message || err);
        // try again if we have retries left
      }
    }
    throw lastError || new Error("Image generation failed");
  };

  const safeCount = clampNumberOfImages(numberOfImages);
  
  // Generate images sequentially with delays to avoid overwhelming Gemini API
  // This reduces timeout errors
  const images = [];
  for (let i = 0; i < safeCount; i++) {
    console.log(`Generating image ${i + 1}/${safeCount}...`);
    try {
      const image = await generateSingleImage();
      images.push(image);
      // Add delay between images to avoid rate limiting and timeouts
      if (i < safeCount - 1) {
        console.log(`Waiting 3 seconds before next image...`);
        await sleep(3000); // 3 second delay between images
      }
    } catch (error) {
      console.error(`Failed to generate image ${i + 1}:`, error?.message || error);
      // Continue with other images even if one fails
      if (images.length === 0) {
        throw error; // Only throw if we have no images at all
      }
    }
  }
  
  if (images.length === 0) {
    throw new Error("Failed to generate any images");
  }
  
  return images;
};

/**
 * Upload generated base64 image to Firebase Storage
 * and return public URL
 */
const uploadGeneratedImageToStorage = async (base64DataUrl, email) => {
  const match = base64DataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid base64 image format");
  }

  const mimeType = match[1];
  const base64Data = match[2];
  const buffer = Buffer.from(base64Data, "base64");
  const extension = mimeType.split("/")[1];

  const filePath = `generated/${email || "anonymous"}/${Date.now()}.${extension}`;
  const file = bucket.file(filePath);

  // Save the file
  await file.save(buffer, {
    metadata: { contentType: mimeType },
    validation: "md5",
  });

  // Make the file publicly accessible
  await file.makePublic();

  // Return the public URL
  return `https://storage.googleapis.com/${bucket.name}/${filePath}`;
};

/**
 * Save generated images to Firestore - stores only Firebase Storage URLs, never base64.
 */
const saveImagesToFirestore = async (email, imageUrls, metadata = {}) => {
  try {
    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      console.warn("No images to save to Firestore");
      return;
    }

    const userEmail = email || "anonymous";
    console.log(`Starting to save ${imageUrls.length} image(s) to Firestore for email: ${userEmail}`);

    for (let i = 0; i < imageUrls.length; i++) {
      const imageUrl = imageUrls[i];
      
      // Ensure we only save Firebase Storage URLs, never base64
      if (!imageUrl || typeof imageUrl !== 'string') {
        console.warn(`Invalid image URL, skipping: ${imageUrl}`);
        continue;
      }

      // Check if it's a base64 data URL (should not happen, but safety check)
      if (imageUrl.startsWith('data:image/')) {
        console.error(`ERROR: Attempted to save base64 to Firestore! This should not happen. URL starts with data:image/`);
        continue; // Skip base64 - should never be saved
      }

      // Ensure it's a valid HTTP/HTTPS URL (Firebase Storage URL)
      if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
        console.warn(`Invalid URL format, skipping: ${imageUrl}`);
        continue;
      }

      const imageData = {
        email: userEmail,
        url: imageUrl, // Store only the Firebase Storage URL
        created_at: new Date(),
        ...metadata,
      };

      try {
        const docRef = await db.collection("images").add(imageData);
        const docId = docRef.id;
        console.log(`✅ Image ${i + 1} saved successfully to Firestore! Doc ID: ${docId}, email: ${userEmail}, URL: ${imageUrl}`);
        
        // Verify the document was actually saved
        const verifyDoc = await db.collection("images").doc(docId).get();
        if (verifyDoc.exists) {
          console.log(`✅ Verified: Document ${docId} exists in Firestore`);
        } else {
          console.error(`❌ WARNING: Document ${docId} was not found after save!`);
        }
      } catch (saveError) {
        console.error(`❌ Failed to save image ${i + 1} to Firestore:`, saveError?.message || saveError);
        console.error(`❌ Error details:`, saveError);
        // Continue with next image even if one fails
      }
    }
    
    // Final verification: count documents for this email
    try {
      const verifySnapshot = await db.collection("images").where("email", "==", userEmail).get();
      console.log(`✅ Final verification: Found ${verifySnapshot.size} document(s) in Firestore for email: ${userEmail}`);
    } catch (verifyError) {
      console.error(`❌ Error during final verification:`, verifyError?.message || verifyError);
    }
    
    console.log(`✅ Completed saving ${imageUrls.length} image(s) to Firestore for email: ${userEmail}`);
  } catch (e) {
    console.error("❌ Firestore save error (global):", e?.message || e);
    console.error("Stack trace:", e?.stack);
    // Continue even if save fails - the images are still returned to frontend
  }
};

// ---------------------- SIGNUP ----------------------
app.post("/signup", async (req, res) => {
  try {
    const { email, nom, prenom, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password required." });
    }

    const userRef = db.collection("users").doc(email);
    const doc = await userRef.get();

    if (doc.exists) {
      return res.json({ success: false, message: "User already exists." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await userRef.set({
      email,
      nom: nom || "",
      prenom: prenom || "",
      password_hash: hashedPassword,
      created_at: new Date(),
    });

    res.json({ success: true, message: "Signup successful." });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ success: false, message: "Error during signup." });
  }
});

// ---------------------- LOGIN ----------------------
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password required." });
    }

    const userRef = db.collection("users").doc(email);
    const doc = await userRef.get();

    if (!doc.exists) {
      return res.json({ success: false, message: "User not found." });
    }

    const userData = doc.data();
    const plainPassword = password || "";

    if (!userData.password_hash) {
      if (!userData.password) {
        return res.json({ success: false, message: "Invalid account." });
      }
      const isLegacyMatch = plainPassword === userData.password;
      if (!isLegacyMatch) {
        return res.json({ success: false, message: "Incorrect password." });
      }
    } else {
      const isMatch = await bcrypt.compare(plainPassword, userData.password_hash);
      if (!isMatch) {
        return res.json({ success: false, message: "Incorrect password." });
      }
    }

    const token = jwt.sign({ email }, SECRET_KEY, { expiresIn: "1h" });

    res.json({
      success: true,
      message: "Login successful.",
      token,
      nom: userData.nom || "",
      prenom: userData.prenom || "",
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ success: false, message: "Error during login." });
  }
});

// ---------------------- DELETE PROFILE ----------------------
app.delete("/delete/:email", async (req, res) => {
  try {
    const email = req.params.email;

    if (!email) {
      return res.status(400).json({ success: false, message: "Email required." });
    }

    await db.collection("users").doc(email).delete();

    const imagesSnapshot = await db.collection("images").where("email", "==", email).get();
    const batch = db.batch();
    imagesSnapshot.forEach((docItem) => batch.delete(db.collection("images").doc(docItem.id)));
    await batch.commit();

    res.json({ success: true, message: "Profile and photos deleted successfully." });
  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json({ success: false, message: "Error during deletion." });
  }
});

// ---------------------- GENERATE IMAGE (Gemini + style) ----------------------
app.post("/generate", async (req, res) => {
  try {
    const { email, style, photos, numberOfImages } = req.body;

    if (!process.env.GOOGLE_API_KEY) {
      return res.status(500).json({ success: false, message: "Missing GOOGLE_API_KEY" });
    }

    if (!style || !Array.isArray(photos)) {
      return res.status(400).json({ success: false, message: "Style and photos array required" });
    }

    if (photos.length === 0) {
      return res.status(400).json({ success: false, message: "At least one photo required" });
    }

    if (photos.length > 10) {
      return res.status(400).json({ success: false, message: "Maximum 10 photos allowed" });
    }

    // Helper function to add face fidelity and clothing consistency requirements
    const addFidelityRequirements = (basePrompt) => {
      return `${basePrompt} Be faithful to the original face: preserve the same eyes (color, shape, expression), face shape, hair style/color/length, and skin tone from the reference photos. Keep the same clothing style, colors, and formality level as shown in the reference photos (do not add costumes or formal wear if not present in the original photos). Only the user should appear in the image—no other people or humans. Style: photorealistic and faithful to the original face.`;
    };

    // Prompts by style (English for better model results)
    let finalPrompt = "";

    switch (style) {
      // 1 Portraits professionnels
      case "professional_indoor":
        finalPrompt = addFidelityRequirements(
          "Professional indoor portrait of the user, well-dressed, modern office or elegant workspace background, soft lighting, serious and credible style. Context: professional post, announcement, career advice."
        );
        break;

      case "professional_outdoor":
        finalPrompt = addFidelityRequirements(
          "Professional outdoor portrait of the user, elegant outfit, pleasant landscape or modern building background, calm and composed atmosphere. Context: inspiring post, storytelling, leadership."
        );
        break;

      case "corporate_studio":
        finalPrompt = addFidelityRequirements(
          "Corporate studio portrait of the user, neutral background, clean and sharp lighting, upright posture. Context: formal post, important announcement or public speaking."
        );
        break;

      // 2 Portraits semi décontractés
      case "modern_workspace":
        finalPrompt = addFidelityRequirements(
          "Semi-casual portrait of the user in a modern workspace or coworking area, bright office ambiance, less formal outfit, visible work accessories. Context: productivity, organization, tips."
        );
        break;

      case "personal_office":
        finalPrompt = addFidelityRequirements(
          "Casual portrait of the user in a personal office, intimate decor, visible personal objects, warm atmosphere. Context: authentic post, sharing experience."
        );
        break;

      case "street":
        finalPrompt = addFidelityRequirements(
          "Casual portrait of the user in an urban street setting, casual outfit, slight movement in posture. Context: lifestyle post, storytelling."
        );
        break;

      // 3 Scènes d'action
      case "working_computer":
        finalPrompt = addFidelityRequirements(
          "Action portrait of the user working on a computer at a desk, focused look, laptop open and visible. Context: productive, technical focus."
        );
        break;

      case "writing_notes":
        finalPrompt = addFidelityRequirements(
          "Action portrait of the user writing or taking notes, notebook and pen visible on a clear table, calm atmosphere. Context: methodology, reflection, coaching."
        );
        break;

      case "presenting_screen":
        finalPrompt = addFidelityRequirements(
          "Action portrait of the user presenting something on screen, pointing gesture toward the computer, screen visible but content blurred. Context: tutorial, analysis, demonstration."
        );
        break;

      case "meeting":
        finalPrompt = addFidelityRequirements(
          "Portrait of the user alone in a meeting setting, table or screen visible, no other people in the frame. Context: management, collaboration."
        );
        break;

      case "walking_street":
        finalPrompt = addFidelityRequirements(
          "Portrait of the user walking in the street alone, natural movement, urban decor, energetic yet professional vibe. Context: motivation, rhythm, momentum."
        );
        break;

      // 4 Selfies naturels
      case "selfie_transport":
        finalPrompt = addFidelityRequirements(
          "Natural selfie of the user in train/car/transport, natural light, realistic position, simple background. Context: on-the-go, business travel."
        );
        break;

      case "selfie_office":
        finalPrompt = addFidelityRequirements(
          "Natural selfie of the user at their desk, computer visible, coherent indoor decor. Context: remote work, workday."
        );
        break;

      case "selfie_outdoor":
        finalPrompt = addFidelityRequirements(
          "Natural selfie of the user outdoors in nature or city, simple gesture (smile, thumbs up). Context: inspiration, storytelling."
        );
        break;

      case "selfie_pointing":
        finalPrompt = addFidelityRequirements(
          "Natural selfie of the user pointing to an off-frame element or the screen, clear gesture for announcement or highlight. Context: announcement, showcasing something new."
        );
        break;

      // 5 Moments du quotidien professionnel
      case "coffee_break":
        finalPrompt = addFidelityRequirements(
          "Casual portrait of the user drinking coffee or a beverage, relaxed mood, warm decor. Context: mood, professional routine."
        );
        break;

      case "eating":
        finalPrompt = addFidelityRequirements(
          "Casual portrait of the user eating a snack or simple meal, authentic scene. Context: lifestyle, work-life balance."
        );
        break;

      // 6 Images centrées sur le produit digital
      case "software_interface":
        finalPrompt = addFidelityRequirements(
          "Staged shot highlighting a software interface, computer or smartphone screen visible, clean ambiance, professional style. Context: demo, launch, product update."
        );
        break;

      case "app_showcase":
        finalPrompt = addFidelityRequirements(
          "Stylized screen capture representation showing an application, immersive representation, modern composition. Context: tech post, announcement, promotion."
        );
        break;

      case "digital_product_context":
        finalPrompt = addFidelityRequirements(
          "Digital product in a professional context, a hand using computer or smartphone, modern decor. Context: feature highlight."
        );
        break;

      // 7 Images centrées sur un produit physique
      case "product_neutral":
        finalPrompt = addFidelityRequirements(
          "Physical product presented in a neutral decor, clean background, minimalist staging. Context: product presentation."
        );
        break;

      case "product_real_context":
        finalPrompt = addFidelityRequirements(
          "Physical product highlighted in a real context (office, indoor, outdoor), natural light, immersive scene. Context: realistic showcase."
        );
        break;

      case "product_used":
        finalPrompt = addFidelityRequirements(
          "Physical product being used by the user, visible interaction. Context: demonstration, real usage."
        );
        break;

      // 8 Catégories à enrichir
      case "mentor_leader":
        finalPrompt = addFidelityRequirements(
          "Inspiring mentor/leader portrait, symbolic staging, confident presence, motivational tone. Context: motivational posts."
        );
        break;

      case "creative_portrait":
        finalPrompt = addFidelityRequirements(
          "Creative portrait with more pronounced colors, modern and graphic style, tasteful composition. Context: creative announcements."
        );
        break;

      case "subtle_humor":
        finalPrompt = addFidelityRequirements(
          "Subtle humorous scene, natural gestures, light tone, professional yet approachable. Context: personal posts."
        );
        break;

      default:
        finalPrompt = addFidelityRequirements("Realistic portrait of the user with a neutral background.");
        break;
    }

    const safeNumberOfImages = clampNumberOfImages(numberOfImages || 4);
    // Mode style: send all photos (up to 10), generate the number chosen by user
    const base64Images = await generateImagesWithGemini(
      finalPrompt,
      photos,
      safeNumberOfImages,
      null // null = send all photos (up to 10)
    );

    // Upload to Firebase Storage
    const storedImageUrls = await Promise.all(
      base64Images.map((img) => uploadGeneratedImageToStorage(img, email))
    );
    
    // Save to Firestore (only URLs, not base64)
    await saveImagesToFirestore(email, storedImageUrls, {
      prompt: finalPrompt,
      style,
      photosCount: photos.length,
    });

    res.json({ success: true, imageUrls: storedImageUrls, prompt: finalPrompt });
  } catch (error) {
    console.error("Generation error:", error);
    res.status(500).json({ success: false, message: "Error during generation." });
  }
});

// ---------------------- GENERATE IMAGE (auto prompt via ChatGPT) ----------------------
app.post("/generate-auto", async (req, res) => {
  try {
    const { email, postText, photos } = req.body;

    // Auto mode: fixed to 2 images for stability
    const requestedCount = 2;

    if (!process.env.GOOGLE_API_KEY) {
      return res.status(500).json({ success: false, message: "Missing GOOGLE_API_KEY" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ success: false, message: "Missing OPENAI_API_KEY" });
    }

    if (!postText || typeof postText !== "string") {
      return res.status(400).json({ success: false, message: "postText is required" });
    }

    if (!Array.isArray(photos) || photos.length < 1) {
      return res.status(400).json({ success: false, message: "Provide at least 1 selfie (base64)" });
    }

    if (photos.length > 2) {
      return res.status(400).json({ success: false, message: "Maximum 2 photos allowed in auto mode" });
    }

    const chatResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.6,
        messages: [
          {
            role: "system",
            content: "You are a prompt engineer for an image model. Input: LinkedIn-style post text + up to two reference selfies of the SAME person. Produce ONE concise prompt (<120 words) ready for the image API. CRITICAL: Deeply analyze the post text to understand its theme, tone, context, and setting. Examples: Corporate/formal posts → professional office, business attire, serious atmosphere. Casual posts → relaxed café, casual clothes, friendly vibe. Sport/fitness posts → gym, outdoor activity, athletic wear, energetic mood. Artistic/creative posts → studio, creative workspace, artistic atmosphere. Technical posts → modern tech office, computer setup, professional tech environment. Nature/travel posts → outdoor setting, natural light, adventure vibe. Event/conference posts → stage, presentation setting, professional networking atmosphere. Philosophical/reflective posts → calm setting, thoughtful mood, introspective atmosphere. Hard constraints: (1) Only that person in frame—no other humans or people. (2) Be faithful to the original face: preserve the same eyes (color, shape, expression), face shape, hair style/color/length, and skin tone from the reference selfies. Say 'be faithful to the original face' in your prompt. (3) Keep the same clothing style, colors, and formality level as shown in the selfies (do not add costumes, suits, or formal wear if not present in the original photos). (4) Style: photorealistic and faithful to the original face. Professional lighting, clear framing/camera hints. No markdown or bullets—return only the final prompt string.",
          },
          {
            role: "user",
            content: `Post text: """${postText}"""

Carefully analyze the theme, tone, context, and setting of this post text. Identify if it's: corporate/formal (office, business), casual (café, relaxed), sport/fitness (gym, outdoor activity), artistic (studio, creative), technical (tech office, coding), nature/travel (outdoor, adventure), event/conference (stage, presentation), or philosophical/reflective (calm, thoughtful). The user provided ${photos.length} reference selfie(s) (base64, same person). Generate one optimized prompt for ${requestedCount} photorealistic portraits that: (1) Keep the user's identity consistent with the selfies, (2) Match the post's theme with appropriate setting, mood, atmosphere, and activity - make the image visually represent the post's message and context.`,
          },
        ],
      }),
    });

    const chatData = await chatResponse.json();

    if (chatData.error) {
      console.error("ChatGPT error:", chatData.error);
      return res.status(500).json({ success: false, message: chatData.error.message || "Prompt generation failed" });
    }

    const optimizedPrompt = chatData?.choices?.[0]?.message?.content?.trim();

    if (!optimizedPrompt) {
      return res.status(500).json({ success: false, message: "No prompt returned by ChatGPT" });
    }

    // Shorten and normalize prompt to avoid overly long requests that can fail with high image counts
    const normalizedPrompt = optimizedPrompt.replace(/\s+/g, " ").trim().slice(0, 700);
    const requirements =
      "Requirements: single person only (no other humans), be faithful to the original face (preserve the same eyes, face shape, hair style/color/length, and skin tone from the reference selfies), keep the SAME clothing style/colors/formality as selfies (no costumes/suits if not in selfies), photorealistic and faithful to the original face, sharp focus, professional lighting, aspect ratio 1:1 or 4:5, no watermarks.";
    const finalPrompt = `${normalizedPrompt}\n${requirements}`;

    // Try generation; fallback to smaller counts if needed
    const tryGenerate = async (count) => {
      const urls = await generateImagesWithGeminiSimple(finalPrompt, photos, count);
      const arr = Array.isArray(urls) ? urls : [];
      const unique = Array.from(new Set(arr));
      return unique.slice(0, count);
    };

    const countsToTry = [requestedCount, 1].filter((c) => c >= 1 && c <= MAX_IMAGES);
    let finalImages = [];
    let lastError = null;

    for (const c of countsToTry) {
      try {
        finalImages = await tryGenerate(c);
        if (finalImages.length > 0) break;
      } catch (err) {
        lastError = err;
        console.error(`Generation failed at ${c} images:`, err?.message || err);
      }
    }

    if (finalImages.length === 0) {
      const message = lastError?.message || "Image model returned no images";
      return res.status(502).json({ success: false, message });
    }

    // Upload to Firebase Storage
    const storedImageUrls = await Promise.all(
      finalImages.map((img) => uploadGeneratedImageToStorage(img, email))
    );

    // Save to Firestore (only URLs, not base64)
    await saveImagesToFirestore(email, storedImageUrls, {
      prompt: finalPrompt,
      source: "auto_prompt",
      photosCount: photos.length,
      postText,
    });

    res.json({ success: true, imageUrls: storedImageUrls, prompt: finalPrompt, optimizedPrompt });
  } catch (error) {
    console.error("Auto generation error:", error);
    res.status(500).json({ success: false, message: "Error during auto generation." });
  }
});

// ---------------------- SAVE FINAL SELECTION ----------------------
app.post("/selection", async (req, res) => {
  try {
    const { email, imageUrl, prompt, flowType } = req.body;

    if (!email || !imageUrl) {
      return res
        .status(400)
        .json({ success: false, message: "email and imageUrl are required to save a selection." });
    }

    // Truncate very large data URLs to avoid Firestore 1MB limit
    let urlToSave = imageUrl;
    if (typeof urlToSave === "string" && urlToSave.length > 800000) {
      urlToSave = urlToSave.substring(0, 500000) + "...[truncated]";
    }

    await db.collection("selections").add({
      email,
      imageUrl: urlToSave,
      prompt: prompt || "",
      flowType: flowType || "unknown",
      saved_at: new Date(),
    });

    res.json({ success: true, message: "Final image selection saved." });
  } catch (error) {
    console.error("Selection save error:", error);
    res.status(500).json({ success: false, message: "Error saving selection." });
  }
});

// ---------------------- DEBUG: CHECK FIRESTORE ----------------------
app.get("/debug/firestore/:email", async (req, res) => {
  try {
    const email = req.params.email;
    console.log(`🔍 DEBUG: Checking Firestore for email: ${email}`);

    // Get all documents for this email
    const imagesSnapshot = await db.collection("images").where("email", "==", email).get();
    console.log(`🔍 Found ${imagesSnapshot.size} documents in Firestore`);

    const allDocs = [];
    imagesSnapshot.forEach((doc) => {
      const data = doc.data();
      allDocs.push({
        id: doc.id,
        email: data.email,
        urlLength: data.url ? data.url.length : 0,
        urlPreview: data.url ? (data.url.length > 100 ? data.url.substring(0, 100) + "..." : data.url) : "NO URL",
        isTruncated: data.url ? data.url.includes("[truncated]") : false,
        originalLength: data.originalLength || 0,
        created_at: data.created_at,
        style: data.style,
        source: data.source,
        photosCount: data.photosCount,
      });
    });

    res.json({
      success: true,
      email,
      totalDocuments: imagesSnapshot.size,
      documents: allDocs,
    });
  } catch (error) {
    console.error("DEBUG error:", error);
    res.status(500).json({ success: false, message: "Debug error", error: error.message });
  }
});

// ---------------------- GET USER GALLERY ----------------------
app.get("/gallery/:email", async (req, res) => {
  try {
    const email = req.params.email;
    console.log("Fetching gallery for email:", email);

    if (!email) {
      return res.status(400).json({ success: false, message: "Email required." });
    }

    // Fetch without orderBy first to avoid index issues
    let imagesSnapshot;
    try {
      imagesSnapshot = await db.collection("images").where("email", "==", email).get();
      console.log(`Found ${imagesSnapshot.size} documents for email: ${email}`);
    } catch (fetchError) {
      console.error("Error fetching images:", fetchError);
      return res.status(500).json({ success: false, message: "Error fetching images from database." });
    }

    const images = [];
    let omittedCount = 0;

    imagesSnapshot.forEach((doc) => {
      const data = doc.data();
      const urlValue = data.url || "";
      const urlLength = urlValue.length;

      // Show full value if short, preview if long
      const urlPreview = urlLength <= 100 ? urlValue : urlValue.substring(0, 50) + "...";

      console.log(
        `Processing doc ${doc.id}, has url: ${!!data.url}, url length: ${urlLength}, url value: "${urlPreview}"`
      );

      // Récupérer toutes les images valides
      // Une vraie image base64 commence par "data:image/"
      // On accepte aussi les images tronquées (qui se terminent par "...[truncated]")
      // Les anciennes images peuvent être "[omitted: too large]" (20 chars) - on les ignore
      if (
        urlValue &&
        urlValue.length > 50 && // Au moins 50 caractères
        urlValue.startsWith("data:image/")
      ) {
        images.push({
          id: doc.id,
          url: urlValue,
          style: data.style || "unknown",
          prompt: data.prompt || "",
          photosCount: data.photosCount || 1,
          created_at: data.created_at?.toDate() || new Date(data.created_at) || new Date(),
          isTruncated: urlValue.includes("[truncated]"),
          originalLength: data.originalLength || urlValue.length,
        });
      } else {
        omittedCount++;
        const reason =
          urlLength <= 20
            ? "old omitted image (too large, lost)"
            : !urlValue.startsWith("data:image/")
            ? "invalid format"
            : "too short";

        console.log(`Skipped image ${doc.id}: ${reason} (length: ${urlLength}, value: "${urlPreview}")`);
      }
    });

    // Sort by date (newest first)
    images.sort((a, b) => {
      const dateA = a.created_at instanceof Date ? a.created_at : new Date(a.created_at);
      const dateB = b.created_at instanceof Date ? b.created_at : new Date(b.created_at);
      return dateB - dateA;
    });

    console.log(`Returning ${images.length} images (${omittedCount} omitted/invalid)`);

    if (omittedCount > 0) {
      console.log(
        `⚠️ Warning: ${omittedCount} old images were skipped because they were saved as "[omitted: too large]" and are unrecoverable. New images will use truncation instead.`
      );
    }

    res.json({ success: true, images, count: images.length, omittedCount });
  } catch (error) {
    console.error("Gallery error:", error);
    res.status(500).json({ success: false, message: "Error fetching gallery.", error: error.message });
  }
});

// ---------------------- DELETE SINGLE IMAGE ----------------------
app.delete("/image/:imageId", async (req, res) => {
  try {
    const imageId = req.params.imageId;

    if (!imageId) {
      return res.status(400).json({ success: false, message: "Image ID required." });
    }

    const imageRef = db.collection("images").doc(imageId);
    const imageDoc = await imageRef.get();

    if (!imageDoc.exists) {
      return res.status(404).json({ success: false, message: "Image not found." });
    }

    await imageRef.delete();

    res.json({ success: true, message: "Image deleted successfully." });
  } catch (error) {
    console.error("Delete image error:", error);
    res.status(500).json({ success: false, message: "Error deleting image." });
  }
});

// ---------------------- LAB MODE: INGEST (Récupération images) ----------------------
app.post("/ingest", async (req, res) => {
  try {
    const { email, prenom, nom, entreprise, siteWeb, linkedin } = req.body;

    if (!prenom || !nom) {
      return res.status(400).json({ success: false, message: "Prénom et nom requis." });
    }

    const images = [];
    const userEmail = email || "anonymous";

    // 1. Scraping du site web
    if (siteWeb) {
      try {
        console.log(`🌐 Scraping site web: ${siteWeb}`);
        const siteRes = await fetch(siteWeb, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
          },
        });
        const html = await siteRes.text();
        
        // Extraction des images avec plusieurs méthodes
        const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
        const srcsetRegex = /<img[^>]+srcset=["']([^"']+)["']/gi;
        const backgroundImageRegex = /background-image:\s*url\(["']?([^"')]+)["']?\)/gi;
        const dataSrcRegex = /<img[^>]+data-src=["']([^"']+)["']/gi;
        const dataSrcsetRegex = /<img[^>]+data-srcset=["']([^"']+)["']/gi;
        
        const allImageUrls = new Set();
        
        // Extraire toutes les URLs d'images
        [...html.matchAll(imgRegex)].forEach(match => {
          if (match[1]) allImageUrls.add(match[1]);
        });
        [...html.matchAll(dataSrcRegex)].forEach(match => {
          if (match[1]) allImageUrls.add(match[1]);
        });
        [...html.matchAll(srcsetRegex)].forEach(match => {
          // srcset peut contenir plusieurs URLs séparées par des virgules
          const urls = match[1].split(',').map(u => u.trim().split(' ')[0]);
          urls.forEach(url => {
            if (url) allImageUrls.add(url);
          });
        });
        [...html.matchAll(dataSrcsetRegex)].forEach(match => {
          const urls = match[1].split(',').map(u => u.trim().split(' ')[0]);
          urls.forEach(url => {
            if (url) allImageUrls.add(url);
          });
        });
        [...html.matchAll(backgroundImageRegex)].forEach(match => {
          if (match[1]) allImageUrls.add(match[1]);
        });
        
        // Convertir et filtrer les URLs
        for (const imgUrl of Array.from(allImageUrls)) {
          let finalUrl = imgUrl;
          
          // Convertir les URLs relatives en absolues
          if (finalUrl.startsWith("//")) {
            finalUrl = `https:${finalUrl}`;
          } else if (finalUrl.startsWith("/")) {
            const urlObj = new URL(siteWeb);
            finalUrl = `${urlObj.origin}${finalUrl}`;
          } else if (!finalUrl.startsWith("http")) {
            const urlObj = new URL(siteWeb);
            finalUrl = `${urlObj.origin}/${finalUrl}`;
          }
          
          // Filtrer les images pertinentes (exclure drapeaux, icônes, logos, etc.)
          const lowerUrl = finalUrl.toLowerCase();
          const isExcluded = 
            lowerUrl.includes("icon") || 
            lowerUrl.includes("logo") || 
            lowerUrl.includes("favicon") ||
            lowerUrl.includes("sprite") ||
            lowerUrl.includes("placeholder") ||
            lowerUrl.includes("flag") ||  // Drapeaux
            lowerUrl.includes("emoji") ||
            lowerUrl.includes("badge") ||
            lowerUrl.includes("button") ||
            lowerUrl.includes("arrow") ||
            lowerUrl.includes("chevron") ||
            lowerUrl.includes("close") ||
            lowerUrl.includes("menu") ||
            lowerUrl.includes("hamburger") ||
            lowerUrl.includes("social") && !lowerUrl.includes("photo") || // Réseaux sociaux mais pas photos
            lowerUrl.includes("share") ||
            lowerUrl.includes("like") ||
            lowerUrl.includes("comment") ||
            lowerUrl.includes("svg") && lowerUrl.length < 100; // Petits SVG (probablement icônes)
          
          const isRelevant = 
            !isExcluded &&
            (lowerUrl.includes("photo") || 
             lowerUrl.includes("image") || 
             lowerUrl.includes("img") ||
             lowerUrl.includes("avatar") ||
             lowerUrl.includes("profile") ||
             lowerUrl.includes("person") ||
             lowerUrl.includes("team") ||
             lowerUrl.includes("about") ||
             lowerUrl.includes("portrait") ||
             lowerUrl.includes("headshot") ||
             lowerUrl.includes("visage") ||
             lowerUrl.includes("face") ||
             lowerUrl.match(/\.(jpg|jpeg|png|gif|webp)/i));
          
          if (isRelevant) {
            images.push({
              url: finalUrl,
              source: "website",
              website: siteWeb,
            });
          }
        }
        
        console.log(`✅ ${images.filter(img => img.source === "website").length} image(s) trouvée(s) sur le site web`);
      } catch (err) {
        console.error("Erreur scraping site web:", err);
      }
    }

    // 2. Récupération depuis le profil LinkedIn
    if (linkedin) {
      try {
        console.log(`💼 Récupération LinkedIn: ${linkedin}`);
        
        // S'assurer que l'URL LinkedIn est complète
        let linkedinUrl = linkedin;
        if (!linkedinUrl.startsWith("http")) {
          if (linkedinUrl.startsWith("/")) {
            linkedinUrl = `https://www.linkedin.com${linkedinUrl}`;
          } else {
            linkedinUrl = `https://www.linkedin.com/in/${linkedinUrl}`;
          }
        }
        
        // Scraping du profil LinkedIn public - stratégie améliorée pour profils publics
        let html = "";
        let linkedinError = null;
        
        // Attendre un peu avant la requête pour simuler un comportement humain
        await new Promise(resolve => setTimeout(resolve, 500));
        
        try {
          // Headers optimisés pour simuler un navigateur réel accédant à un profil public
          const linkedinRes = await fetch(linkedinUrl, {
            method: "GET",
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
              "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
              "Accept-Encoding": "gzip, deflate, br, zstd",
              "Referer": "https://www.google.com/",
              "Origin": "https://www.google.com",
              "Sec-Fetch-Dest": "document",
              "Sec-Fetch-Mode": "navigate",
              "Sec-Fetch-Site": "cross-site",
              "Sec-Fetch-User": "?1",
              "Sec-Ch-Ua": '"Chromium";v="131", "Not_A Brand";v="24"',
              "Sec-Ch-Ua-Mobile": "?0",
              "Sec-Ch-Ua-Platform": '"Windows"',
              "Upgrade-Insecure-Requests": "1",
              "Cache-Control": "no-cache",
              "Pragma": "no-cache",
              "DNT": "1",
              "Connection": "keep-alive",
            },
            redirect: "follow",
            // Timeout plus long pour LinkedIn
            signal: AbortSignal.timeout(20000), // 20 secondes
          });
          
          const status = linkedinRes.status;
          console.log(`📊 Statut LinkedIn: ${status}`);
          
          if (status === 200) {
            html = await linkedinRes.text();
            console.log(`✅ HTML LinkedIn récupéré avec succès (${html.length} caractères)`);
          } else if (status === 999) {
            linkedinError = `LinkedIn bloque l'accès (statut 999 - protection anti-bot)`;
            console.log(`⚠️ ${linkedinError}`);
            console.log(`ℹ️ LinkedIn détecte probablement un bot. Les profils publics devraient être accessibles sans authentification.`);
            console.log(`ℹ️ Suggestion: Vérifiez que l'URL du profil est correcte et que le profil est bien public.`);
          } else if (status === 401 || status === 403) {
            linkedinError = `Accès refusé (statut ${status}) - Le profil pourrait être privé ou nécessiter une connexion`;
            console.log(`⚠️ ${linkedinError}`);
          } else {
            linkedinError = `LinkedIn retourne le statut ${status}`;
            console.log(`⚠️ ${linkedinError}`);
          }
        } catch (fetchErr) {
          if (fetchErr.name === 'AbortError') {
            linkedinError = `Timeout lors de la récupération LinkedIn (plus de 20 secondes)`;
          } else if (fetchErr.code === 'ENOTFOUND' || fetchErr.code === 'ECONNREFUSED') {
            linkedinError = `Erreur de connexion à LinkedIn: ${fetchErr.message}`;
          } else {
            linkedinError = `Erreur fetch LinkedIn: ${fetchErr.message}`;
          }
          console.error(linkedinError);
        }
        
        if (html) {
          // Extraction exhaustive des images du profil LinkedIn
          const allImageUrls = new Set();
          
          // Méthode 1: Balises img classiques
          const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
          const matches = [...html.matchAll(imgRegex)];
          for (const match of matches) {
            if (match[1]) {
              let imgUrl = match[1];
              // LinkedIn utilise souvent des URLs avec des paramètres
              imgUrl = imgUrl.split('?')[0]; // Enlever les paramètres de requête
              if (imgUrl && imgUrl.length > 10) {
                allImageUrls.add(imgUrl);
              }
            }
          }
          
          // Méthode 2: Attributs data-src (lazy loading)
          const dataSrcRegex = /<img[^>]+data-src=["']([^"']+)["'][^>]*>/gi;
          const dataMatches = [...html.matchAll(dataSrcRegex)];
          for (const match of dataMatches) {
            if (match[1]) {
              let imgUrl = match[1].split('?')[0];
              if (imgUrl && imgUrl.length > 10) {
                allImageUrls.add(imgUrl);
              }
            }
          }
          
          // Méthode 3: Background images
          const backgroundImageRegex = /background-image:\s*url\(["']?([^"')]+)["']?\)/gi;
          const bgMatches = [...html.matchAll(backgroundImageRegex)];
          for (const match of bgMatches) {
            if (match[1]) {
              let imgUrl = match[1].split('?')[0];
              if (imgUrl && imgUrl.length > 10) {
                allImageUrls.add(imgUrl);
              }
            }
          }
          
          // Méthode 4: URLs dans les attributs data (LinkedIn stocke souvent les images là)
          const dataImageRegex = /data-image=["']([^"']+)["']/gi;
          const dataImageMatches = [...html.matchAll(dataImageRegex)];
          for (const match of dataImageMatches) {
            if (match[1]) {
              let imgUrl = match[1].split('?')[0];
              if (imgUrl && imgUrl.length > 10) {
                allImageUrls.add(imgUrl);
              }
            }
          }
          
          // Méthode 5: URLs dans les scripts JSON (LinkedIn charge souvent les images via JSON)
          const jsonImageRegex = /"image":"([^"]+)"/gi;
          const jsonMatches = [...html.matchAll(jsonImageRegex)];
          for (const match of jsonMatches) {
            if (match[1]) {
              let imgUrl = match[1].replace(/\\\//g, '/').split('?')[0];
              if (imgUrl && imgUrl.length > 10) {
                allImageUrls.add(imgUrl);
              }
            }
          }
          
          // Filtrer et normaliser les URLs
          for (const imgUrl of Array.from(allImageUrls)) {
            let finalUrl = imgUrl;
            
            // Normaliser les URLs
            if (finalUrl.startsWith("//")) {
              finalUrl = `https:${finalUrl}`;
            } else if (finalUrl.startsWith("/")) {
              finalUrl = `https://www.linkedin.com${finalUrl}`;
            }
            
            // Filtrer les images pertinentes (exclure drapeaux, icônes, etc.)
            const lowerUrl = finalUrl.toLowerCase();
            const isExcluded = 
              lowerUrl.includes("icon") || 
              lowerUrl.includes("logo") || 
              lowerUrl.includes("favicon") ||
              lowerUrl.includes("sprite") ||
              lowerUrl.includes("placeholder") ||
              lowerUrl.includes("flag") ||  // Drapeaux
              lowerUrl.includes("emoji") ||
              lowerUrl.includes("badge") ||
              lowerUrl.includes("button") ||
              lowerUrl.includes("arrow") ||
              lowerUrl.includes("chevron") ||
              lowerUrl.includes("close") ||
              lowerUrl.includes("menu") ||
              lowerUrl.includes("hamburger") ||
              lowerUrl.includes("social") && !lowerUrl.includes("photo") ||
              lowerUrl.includes("share") ||
              lowerUrl.includes("like") ||
              lowerUrl.includes("comment") ||
              lowerUrl.includes("svg") && lowerUrl.length < 100;
            
            const isRelevant = 
              !isExcluded &&
              finalUrl.startsWith("http") &&
              // Inclure les images qui semblent être des photos de personnes
              (lowerUrl.includes("media") || 
               lowerUrl.includes("profile") || 
               lowerUrl.includes("photo") ||
               lowerUrl.includes("image") ||
               lowerUrl.includes("avatar") ||
               lowerUrl.includes("person") ||
               lowerUrl.includes("headshot") ||
               lowerUrl.includes("portrait") ||
               lowerUrl.includes("visage") ||
               lowerUrl.includes("face") ||
               lowerUrl.match(/\.(jpg|jpeg|png|gif|webp)/i));
            
            if (isRelevant) {
              images.push({
                url: finalUrl,
                source: "linkedin",
                linkedinProfile: linkedin,
              });
            }
          }
          
          const linkedinImagesCount = images.filter(img => img.source === "linkedin").length;
          if (linkedinImagesCount > 0) {
            console.log(`✅ ${linkedinImagesCount} image(s) trouvée(s) sur LinkedIn`);
          } else {
            console.log(`⚠️ Aucune image récupérée de LinkedIn`);
          }
          
          if (linkedinImagesCount === 0 && linkedinError) {
            console.log(`ℹ️ ${linkedinError}`);
            console.log(`ℹ️ LinkedIn utilise une protection anti-bot stricte. Les images du site web ont été récupérées avec succès.`);
          }
        } else {
          if (linkedinError) {
            console.log(`⚠️ ${linkedinError}`);
            console.log(`ℹ️ Les images du site web ont été récupérées avec succès malgré l'échec LinkedIn.`);
          } else {
            console.log("⚠️ Impossible de récupérer le HTML de LinkedIn");
            console.log(`ℹ️ Les images du site web ont été récupérées avec succès.`);
          }
        }
      } catch (err) {
        console.error("Erreur LinkedIn:", err);
      }
    }

    // Sauvegarder les images dans Firestore
    const savedImages = [];
    for (const img of images) {
      try {
        // Télécharger l'image et l'uploader dans Firebase Storage
        const imgRes = await fetch(img.url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });
        
        if (imgRes.ok) {
          const arrayBuffer = await imgRes.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const extension = img.url.split(".").pop()?.split("?")[0] || "jpg";
          const filePath = `lab/${userEmail}/${Date.now()}-${Math.random().toString(36).substring(7)}.${extension}`;
          const file = bucket.file(filePath);
          
          await file.save(buffer, {
            metadata: { contentType: imgRes.headers.get("content-type") || "image/jpeg" },
          });
          await file.makePublic();
          
          const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
          
          // Sauvegarder dans Firestore
          const docRef = await db.collection("images").add({
            email: userEmail,
            url: publicUrl,
            source: img.source,
            created_at: new Date(),
            labData: {
              prenom,
              nom,
              entreprise,
              siteWeb,
              linkedin,
            },
          });
          
          savedImages.push({
            id: docRef.id,
            url: publicUrl,
            source: img.source,
          });
        }
      } catch (err) {
        console.error(`Erreur sauvegarde image ${img.url}:`, err);
      }
    }

    // Pas de limite stricte - récupérer toutes les images valides trouvées
    const websiteCount = savedImages.filter(img => img.source === "website").length;
    const linkedinCount = savedImages.filter(img => img.source === "linkedin").length;
    
    let message = `${savedImages.length} visuel(s) récupéré(s) et sauvegardé(s)`;
    if (websiteCount > 0 && linkedinCount > 0) {
      message += ` (${websiteCount} du site web, ${linkedinCount} de LinkedIn)`;
    } else if (websiteCount > 0) {
      message += ` (${websiteCount} du site web)`;
      if (linkedin) {
        message += `. Note: LinkedIn a bloqué l'accès (protection anti-bot - statut 999).`;
      }
    } else if (linkedinCount > 0) {
      message += ` (${linkedinCount} de LinkedIn)`;
    }
    
    res.json({
      success: true,
      images: savedImages,
      count: savedImages.length,
      websiteCount,
      linkedinCount,
      message,
    });
  } catch (error) {
    console.error("Ingest error:", error);
    res.status(500).json({ success: false, message: "Erreur lors de la récupération des visuels." });
  }
});

// ---------------------- LAB MODE: TAG BATCH (Tagging automatique) ----------------------
app.post("/tag/batch", async (req, res) => {
  try {
    const { email, imageIds } = req.body;

    if (!Array.isArray(imageIds) || imageIds.length === 0) {
      return res.status(400).json({ success: false, message: "Liste d'IDs d'images requise." });
    }

    const userEmail = email || "anonymous";
    const taggedImages = [];

    for (const imageId of imageIds) {
      try {
        const imageRef = db.collection("images").doc(imageId);
        const imageDoc = await imageRef.get();

        if (!imageDoc.exists) {
          console.warn(`Image ${imageId} non trouvée`);
          continue;
        }

        const imageData = imageDoc.data();
        const imageUrl = imageData.url;

        if (!imageUrl) {
          console.warn(`Image ${imageId} sans URL`);
          continue;
        }

        // Génération de tags avec OpenAI (analyse de l'image via description)
        let tags = [];
        let context = {};

        if (process.env.OPENAI_API_KEY) {
          try {
            // Télécharger l'image pour l'analyser
            const imgRes = await fetch(imageUrl);
            const imgArrayBuffer = await imgRes.arrayBuffer();
            const imgBuffer = Buffer.from(imgArrayBuffer);
            const base64Image = imgBuffer.toString("base64");

            // Utiliser GPT-4 Vision pour analyser l'image avec un prompt très détaillé
            const analysisRes = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              },
              body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                  {
                    role: "user",
                    content: [
                      {
                        type: "text",
                        text: `Analyse cette image en DÉTAIL et génère des tags SPÉCIFIQUES et UNIQUES basés sur le contenu réel de l'image. 

INSTRUCTIONS:
1. Décris précisément ce que tu vois dans l'image (personne, objet, lieu, action, style, couleurs, ambiance)
2. Génère 5-10 tags SPÉCIFIQUES et VARIÉS (pas génériques) basés sur:
   - Le contenu principal (visage, bureau, produit, événement, nature, etc.)
   - Le style (formel, casual, créatif, professionnel, décontracté, etc.)
   - Le contexte (bureau, extérieur, studio, café, événement, etc.)
   - L'ambiance (sérieux, joyeux, inspirant, technique, etc.)
   - Les détails visuels (couleurs dominantes, éclairage, composition)
3. Chaque image doit avoir des tags DIFFÉRENTS selon son contenu réel
4. Évite les tags génériques comme "image" ou "photo"

Exemples de tags spécifiques: "visage_souriant", "bureau_moderne", "événement_networking", "portrait_professionnel", "selfie_casual", "produit_tech", "équipe_travail", "conférence_scène", "nature_paysage", "café_détente", etc.

Réponds UNIQUEMENT en JSON valide:
{
  "tags": ["tag1", "tag2", "tag3", ...],
  "context": {
    "location": "indoor/outdoor/studio/événement/etc",
    "formality": "formel/casual/mixte",
    "ambiance": "description précise de l'ambiance",
    "action": "description de l'action ou pose",
    "hasFace": true/false,
    "mainSubject": "description du sujet principal"
  }
}`,
                      },
                      {
                        type: "image_url",
                        image_url: {
                          url: `data:image/jpeg;base64,${base64Image}`,
                        },
                      },
                    ],
                  },
                ],
                temperature: 0.8, // Plus de créativité pour des tags variés
                max_tokens: 500,
              }),
            });

            const analysisData = await analysisRes.json();
            const analysisText = analysisData?.choices?.[0]?.message?.content || "";

            // Parser la réponse JSON (gérer les cas où il y a du texte avant/après le JSON)
            try {
              // Extraire le JSON même s'il y a du texte autour
              let jsonText = analysisText.trim();
              
              // Chercher le JSON entre accolades
              const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                jsonText = jsonMatch[0];
              }
              
              const parsed = JSON.parse(jsonText);
              tags = Array.isArray(parsed.tags) ? parsed.tags : [];
              context = parsed.context || {};
              
              // S'assurer qu'on a au moins quelques tags
              if (tags.length === 0) {
                tags = ["visage", "portrait", "professionnel"];
              }
              
              // Si un visage est détecté, s'assurer qu'un tag de visage est présent
              if (parsed.hasFace && !tags.some(t => {
                const lower = t.toLowerCase();
                return lower.includes("visage") || lower.includes("face") || lower.includes("portrait") || lower.includes("personne");
              })) {
                tags.unshift("visage");
              }
              
              // Prioriser les tags de visage en début de liste
              tags.sort((a, b) => {
                const aIsFace = a.toLowerCase().includes("visage") || a.toLowerCase().includes("face") || a.toLowerCase().includes("portrait") || a.toLowerCase().includes("personne");
                const bIsFace = b.toLowerCase().includes("visage") || b.toLowerCase().includes("face") || b.toLowerCase().includes("portrait") || b.toLowerCase().includes("personne");
                if (aIsFace && !bIsFace) return -1;
                if (!aIsFace && bIsFace) return 1;
                return 0;
              });
              
              console.log(`✅ Tags générés pour image ${imageId}: ${tags.join(", ")}`);
            } catch (parseErr) {
              console.error(`Erreur parsing JSON pour image ${imageId}:`, parseErr);
              console.log(`Texte reçu: ${analysisText.substring(0, 200)}...`);
              // Fallback: tags variés selon l'index pour éviter la répétition
              const fallbackTags = [
                ["visage", "portrait", "professionnel", "bureau"],
                ["visage", "souriant", "casual", "détente"],
                ["portrait", "formel", "bureau", "travail"],
                ["visage", "équipe", "collaboration", "bureau"],
                ["portrait", "événement", "networking", "professionnel"],
              ];
              tags = fallbackTags[imageIds.indexOf(imageId) % fallbackTags.length];
              context = { location: "indoor", formality: "formel", ambiance: "neutre", hasFace: true };
            }
          } catch (err) {
            console.error(`Erreur analyse image ${imageId}:`, err);
            // Tags par défaut
            tags = ["visage", "portrait"];
            context = { location: "indoor", formality: "formel" };
          }
        } else {
          // Tags par défaut si pas d'API OpenAI
          tags = ["visage", "portrait", "professionnel"];
          context = { location: "indoor", formality: "formel", ambiance: "neutre" };
        }

        // Mettre à jour Firestore
        await imageRef.update({
          tags,
          context,
          tagged_at: new Date(),
        });

        taggedImages.push({
          id: imageId,
          tags,
          context,
        });
      } catch (err) {
        console.error(`Erreur tagging image ${imageId}:`, err);
      }
    }

    res.json({
      success: true,
      taggedImages,
      count: taggedImages.length,
      message: `${taggedImages.length} image(s) tagguée(s) avec succès.`,
    });
  } catch (error) {
    console.error("Tag batch error:", error);
    res.status(500).json({ success: false, message: "Erreur lors du tagging." });
  }
});

// ---------------------- LAB MODE: POST ANALYZE (Analyse du post) ----------------------
app.post("/post/analyze", async (req, res) => {
  try {
    const { email, postText } = req.body;

    if (!postText || typeof postText !== "string") {
      return res.status(400).json({ success: false, message: "Texte du post requis." });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ success: false, message: "OPENAI_API_KEY non configurée." });
    }

    // Analyser le post avec OpenAI - prompt amélioré pour plus de précision
    const analysisRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          {
            role: "system",
            content: `Tu es un expert en analyse de contenu LinkedIn et en sélection d'images. 

Analyse le texte du post en DÉTAIL et détermine:
1. Les THÈMES PRINCIPAUX (3-5 thèmes spécifiques, pas génériques)
   - Exemples: "entrepreneuriat", "formation", "événement", "témoignage", "conseil", "innovation", etc.
   - Évite les thèmes trop génériques comme "professionnel" ou "contenu"

2. La TONALITÉ précise (pas juste "neutre")
   - Exemples: "inspirant", "pédagogique", "motivant", "formel", "décontracté", "enthousiaste", "réfléchi", etc.

3. Le CONTEXTE spécifique
   - Exemples: "bureau moderne", "événement networking", "café détente", "studio photo", "extérieur nature", "conférence scène", etc.

4. Les TAGS D'IMAGES DÉSIRÉS (5-8 tags spécifiques)
   - Basés sur le contenu réel du post
   - Exemples: "visage_souriant", "bureau_travail", "événement_scène", "équipe_collaboration", "portrait_professionnel", etc.
   - Chaque post doit avoir des tags DIFFÉRENTS selon son contenu

IMPORTANT: Analyse le contenu RÉEL du post, pas des valeurs par défaut. Chaque post est unique.

Réponds UNIQUEMENT en JSON valide:
{
  "themes": ["theme1", "theme2", ...],
  "tone": "tonalité précise",
  "context": "description précise du contexte",
  "desiredTags": ["tag1", "tag2", ...]
}`,
          },
          {
            role: "user",
            content: `Analyse ce post LinkedIn en détail et génère une analyse SPÉCIFIQUE basée sur son contenu réel:\n\n"""${postText}"""\n\nGénère des thèmes, une tonalité, un contexte et des tags d'images qui correspondent PRÉCISÉMENT au contenu de ce post, pas des valeurs génériques.`,
          },
        ],
        temperature: 0.8, // Plus de créativité pour des analyses variées
        max_tokens: 600,
      }),
    });

    const analysisData = await analysisRes.json();
    const analysisText = analysisData?.choices?.[0]?.message?.content || "";

    let analysis = {};
    try {
      // Extraire le JSON même s'il y a du texte autour
      let jsonText = analysisText.trim();
      const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonText = jsonMatch[0];
      }
      analysis = JSON.parse(jsonText);
      
      // Valider et nettoyer les données
      if (!Array.isArray(analysis.themes)) {
        analysis.themes = ["professionnel", "contenu"];
      }
      if (!analysis.tone || analysis.tone === "neutre") {
        // Essayer de déterminer la tonalité depuis le texte
        const lowerText = postText.toLowerCase();
        if (lowerText.includes("🔥") || lowerText.includes("excit") || lowerText.includes("fantast")) {
          analysis.tone = "enthousiaste";
        } else if (lowerText.includes("merci") || lowerText.includes("remerci")) {
          analysis.tone = "reconnaissant";
        } else if (lowerText.includes("conseil") || lowerText.includes("astuce")) {
          analysis.tone = "pédagogique";
        } else {
          analysis.tone = "professionnel";
        }
      }
      if (!analysis.context) {
        analysis.context = "bureau";
      }
      if (!Array.isArray(analysis.desiredTags) || analysis.desiredTags.length === 0) {
        analysis.desiredTags = ["visage", "portrait", "professionnel"];
      }
      
      console.log(`✅ Analyse du post: thèmes=${analysis.themes.join(", ")}, tonalité=${analysis.tone}, tags=${analysis.desiredTags.join(", ")}`);
    } catch (parseErr) {
      console.error("Erreur parsing JSON analyse post:", parseErr);
      console.log(`Texte reçu: ${analysisText.substring(0, 300)}...`);
      // Fallback avec analyse basique du texte
      const lowerText = postText.toLowerCase();
      const themes = [];
      if (lowerText.includes("événement") || lowerText.includes("event")) themes.push("événement");
      if (lowerText.includes("formation") || lowerText.includes("atelier")) themes.push("formation");
      if (lowerText.includes("conseil") || lowerText.includes("astuce")) themes.push("conseil");
      if (lowerText.includes("témoignage") || lowerText.includes("avis")) themes.push("témoignage");
      if (themes.length === 0) themes.push("professionnel");
      
      analysis = {
        themes: themes,
        tone: lowerText.includes("🔥") ? "enthousiaste" : "professionnel",
        context: lowerText.includes("événement") ? "événement" : "bureau",
        desiredTags: ["visage", "portrait", "professionnel"],
      };
    }

    // Sauvegarder l'analyse dans Firestore
    const userEmail = email || "anonymous";
    await db.collection("posts_analysis").add({
      email: userEmail,
      postText,
      themes: analysis.themes || [],
      tone: analysis.tone || "neutre",
      desiredTags: analysis.desiredTags || [],
      context: analysis.context || "",
      created_at: new Date(),
    });

    res.json({
      success: true,
      analysis,
      message: "Post analysé avec succès.",
    });
  } catch (error) {
    console.error("Post analyze error:", error);
    res.status(500).json({ success: false, message: "Erreur lors de l'analyse du post." });
  }
});

// ---------------------- LAB MODE: SELECT (Sélection image pertinente) ----------------------
app.post("/select", async (req, res) => {
  try {
    const { email, postText } = req.body;

    if (!postText || typeof postText !== "string") {
      return res.status(400).json({ success: false, message: "Texte du post requis." });
    }

    const userEmail = email || "anonymous";

    // 1. Récupérer l'analyse du post la plus récente ou analyser si nécessaire
    let desiredTags = [];
    
    try {
      // Chercher la dernière analyse pour ce post
      const analysisSnapshot = await db.collection("posts_analysis")
        .where("email", "==", userEmail)
        .where("postText", "==", postText)
        .orderBy("created_at", "desc")
        .limit(1)
        .get();
      
      if (!analysisSnapshot.empty) {
        const latestAnalysis = analysisSnapshot.docs[0].data();
        desiredTags = latestAnalysis.desiredTags || [];
        console.log(`✅ Utilisation de l'analyse existante avec ${desiredTags.length} tags`);
      }
    } catch (err) {
      console.log("⚠️ Impossible de récupérer l'analyse existante, extraction des tags...");
    }
    
    // Si pas d'analyse trouvée, extraire les tags depuis le post
    if (desiredTags.length === 0) {
      if (process.env.OPENAI_API_KEY) {
        try {
          const analysisRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
              model: OPENAI_MODEL,
              messages: [
                {
                  role: "system",
                  content: "Extrais les tags d'images désirés de ce post LinkedIn. Réponds uniquement avec une liste JSON de tags: [\"tag1\", \"tag2\"]",
                },
                {
                  role: "user",
                  content: postText,
                },
              ],
              temperature: 0.5,
              max_tokens: 200,
            }),
          });

          const analysisData = await analysisRes.json();
          const tagsText = analysisData?.choices?.[0]?.message?.content || "";
          try {
            // Extraire le JSON même s'il y a du texte autour
            let jsonText = tagsText.trim();
            const jsonMatch = jsonText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              jsonText = jsonMatch[0];
            }
            desiredTags = JSON.parse(jsonText);
          } catch {
            desiredTags = ["visage", "portrait", "professionnel"];
          }
        } catch (err) {
          console.error("Erreur extraction tags:", err);
          desiredTags = ["visage", "portrait", "professionnel"];
        }
      } else {
        desiredTags = ["visage", "portrait", "professionnel"];
      }
    }
    
    console.log(`🔍 Tags désirés pour la sélection: ${desiredTags.join(", ")}`);

    // 2. Récupérer toutes les images de l'utilisateur avec leurs tags
    const imagesSnapshot = await db.collection("images").where("email", "==", userEmail).get();
    const images = [];

    imagesSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.url && data.tags && Array.isArray(data.tags)) {
        images.push({
          id: doc.id,
          url: data.url,
          tags: data.tags,
          context: data.context || {},
          source: data.source || "unknown",
        });
      }
    });

    if (images.length === 0) {
      return res.status(404).json({ success: false, message: "Aucune image tagguée trouvée." });
    }

    // 3. Calculer un score de pertinence pour chaque image
    const scoredImages = images.map((img) => {
      let score = 0;
      const imgTags = img.tags.map((t) => t.toLowerCase());

      // Compter les correspondances de tags
      for (const desiredTag of desiredTags) {
        const lowerTag = desiredTag.toLowerCase();
        if (imgTags.some((it) => it.includes(lowerTag) || lowerTag.includes(it))) {
          score += 2;
        }
      }

      // Bonus pour certaines sources
      if (img.source === "linkedin") score += 1;
      if (img.source === "website") score += 0.5;

      return {
        ...img,
        score,
      };
    });

    // 4. Trier par score et sélectionner la meilleure
    scoredImages.sort((a, b) => b.score - a.score);
    const selectedImage = scoredImages[0];
    const shortlist = scoredImages.slice(0, 5).filter((img) => img.score > 0);

    // 5. Sauvegarder la sélection dans l'analyse du post (dernière analyse)
    try {
      const analysisSnapshot = await db.collection("posts_analysis").where("email", "==", userEmail).get();
      if (!analysisSnapshot.empty) {
        // Trouver la plus récente manuellement
        let latestDoc = null;
        let latestDate = null;
        analysisSnapshot.forEach((doc) => {
          const data = doc.data();
          const docDate = data.created_at?.toDate?.() || new Date(data.created_at);
          if (!latestDate || docDate > latestDate) {
            latestDate = docDate;
            latestDoc = doc;
          }
        });
        
        if (latestDoc) {
          await latestDoc.ref.update({
            selectedImageId: selectedImage.id,
            selectedImageUrl: selectedImage.url,
            selectionScore: selectedImage.score,
          });
        }
      }
    } catch (err) {
      console.error("Erreur sauvegarde sélection:", err);
      // Continue même si la sauvegarde échoue
    }

    res.json({
      success: true,
      selectedImage: {
        id: selectedImage.id,
        url: selectedImage.url,
        tags: selectedImage.tags,
        context: selectedImage.context,
        score: selectedImage.score,
      },
      shortlist: shortlist.map((img) => ({
        id: img.id,
        url: img.url,
        tags: img.tags,
        score: img.score,
      })),
      message: "Image recommandée sélectionnée avec succès.",
    });
  } catch (error) {
    console.error("Select error:", error);
    res.status(500).json({ success: false, message: "Erreur lors de la sélection de l'image." });
  }
});

// ---------------------- START SERVER ----------------------
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});
