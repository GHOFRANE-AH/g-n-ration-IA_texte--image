require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const admin = require("firebase-admin");

// node-fetch v3 is ESM; use a tiny wrapper so fetch works in CommonJS
const fetch = (...args) => import("node-fetch").then(({ default: fetchFn }) => fetchFn(...args));

const serviceAccount = require("./config/serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: serviceAccount.project_id,
});

const db = admin.firestore();
const app = express();

app.use(cors());
app.use(bodyParser.json({ limit: "50mb" })); // allow larger payloads for up to 10 images

const SECRET_KEY = process.env.SECRET_KEY || "supersecret";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const MAX_IMAGES = 4;
const clampNumberOfImages = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(Math.max(Math.round(numeric), 1), MAX_IMAGES);
};

/**
 * Call Gemini image endpoint and return base64 data URLs.
 * @param {string} finalPrompt
 * @param {string[]} photos base64 without data: prefix
 * @param {number} numberOfImages 1..4
 */
const generateImagesWithGemini = async (finalPrompt, photos, numberOfImages) => {
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
      }
    }
    throw lastError || new Error("Image generation failed");
  };

  const safeCount = clampNumberOfImages(numberOfImages);
  const imagePromises = Array.from({ length: safeCount }, () => generateSingleImage());
  return Promise.all(imagePromises);
};

/**
 * Save generated images to Firestore with truncation guard.
 */
const saveImagesToFirestore = async (email, imageUrls, metadata = {}) => {
  try {
    for (const imageUrl of imageUrls) {
      const imageLength = imageUrl.length;
      console.log(`Saving image, length: ${imageLength} characters`);

      let urlToSave = imageUrl;

      if (imageLength > 800000) {
        console.warn(
          `Image too large (${imageLength} chars), truncating to 500KB. Consider using Firebase Storage for large images.`
        );
        urlToSave = imageUrl.substring(0, 500000) + "...[truncated]";
      }

      const imageData = {
        email: email || "anonymous",
        url: urlToSave,
        created_at: new Date(),
        originalLength: imageLength,
        ...metadata,
      };

      await db.collection("images").add(imageData);

      console.log(
        `Image saved for email: ${email || "anonymous"}, original: ${imageLength} chars, saved: ${urlToSave.length} chars`
      );
    }

    console.log(`All ${imageUrls.length} images saved to Firestore`);
  } catch (e) {
    console.error("Firestore save error:", e?.message || e);
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

// ---------------------- GENERATE IMAGE ----------------------
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

    const addFidelityRequirements = (basePrompt) => {
      return `${basePrompt} 
Be faithful to the original face: preserve the same eyes (color, shape, expression), face shape, hair style/color/length, and skin tone from the reference photos.
Keep the same clothing style, colors, and formality level as shown in the reference photos (do not add costumes or formal wear if not present in the original photos).
Only the user should appear in the image—no other people or humans.
Style: photorealistic and faithful to the original face.`;
    };

    let finalPrompt = "";

    switch (style) {
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
    const imageUrls = await generateImagesWithGemini(finalPrompt, photos, safeNumberOfImages);

    await saveImagesToFirestore(email, imageUrls, {
      prompt: finalPrompt,
      style,
      photosCount: photos.length,
    });

    res.json({ success: true, imageUrls, prompt: finalPrompt });
  } catch (error) {
    console.error("Generation error:", error);
    res.status(500).json({ success: false, message: "Error during generation." });
  }
});

// ---------------------- GENERATE AUTO ----------------------
app.post("/generate-auto", async (req, res) => {
  try {
    const { email, postText, photos } = req.body;

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
            content:
              "You are a prompt engineer for an image model. Input: LinkedIn-style post text + up to two reference selfies of the SAME person. Produce ONE concise prompt (<120 words) ready for the image API. CRITICAL: Deeply analyze the post text to understand its theme, tone, context, and setting. Examples: Corporate/formal posts → professional office, business attire, serious atmosphere. Casual posts → relaxed café, casual clothes, friendly vibe. Sport/fitness posts → gym, outdoor activity, athletic wear, energetic mood. Artistic/creative posts → studio, creative workspace, artistic atmosphere. Technical posts → modern tech office, computer setup, professional tech environment. Nature/travel posts → outdoor setting, natural light, adventure vibe. Event/conference posts → stage, presentation setting, professional networking atmosphere. Philosophical/reflective posts → calm setting, thoughtful mood, introspective atmosphere. Hard constraints: (1) Only that person in frame—no other humans or people. (2) Be faithful to the original face: preserve the same eyes (color, shape, expression), face shape, hair style/color/length, and skin tone from the reference selfies. Say 'be faithful to the original face' in your prompt. (3) Keep the same clothing style, colors, and formality level as shown in the selfies (do not add costumes, suits, or formal wear if not present in the original photos). (4) Style: photorealistic and faithful to the original face. Professional lighting, clear framing/camera hints. No markdown or bullets—return only the final prompt string.",
          },
          {
            role: "user",
            content: `Post text: """${postText}"""

Carefully analyze the theme, tone, context, and setting of this post text. Identify if it's:
corporate/formal (office, business),
casual (café, relaxed),
sport/fitness (gym, outdoor activity),
artistic (studio, creative),
technical (tech office, coding),
nature/travel (outdoor, adventure),
event/conference (stage, presentation),
philosophical/reflective (calm, thoughtful).

The user provided ${photos.length} reference selfie(s) (base64, same person).

Generate one optimized prompt for ${requestedCount} photorealistic portraits that:
(1) Keep the user's identity consistent with the selfies,
(2) Match the post's theme with appropriate setting, mood, atmosphere, and activity – make the image visually represent the post's message and context.`,
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

    const normalizedPrompt = optimizedPrompt.replace(/\s+/g, " ").trim().slice(0, 700);

    const requirements =
      "Requirements: single person only (no other humans), be faithful to the original face (preserve the same eyes, face shape, hair style/color/length, and skin tone from the reference selfies), keep the SAME clothing style/colors/formality as selfies (no costumes/suits if not in selfies), photorealistic and faithful to the original face, sharp focus, professional lighting, aspect ratio 1:1 or 4:5, no watermarks.";

    const finalPrompt = `${normalizedPrompt}\n${requirements}`;

    const tryGenerate = async (count) => {
      const urls = await generateImagesWithGemini(finalPrompt, photos, count);
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

    await saveImagesToFirestore(email, finalImages, {
      prompt: finalPrompt,
      source: "auto_prompt",
      photosCount: photos.length,
      postText,
    });

    res.json({ success: true, imageUrls: finalImages, prompt: finalPrompt, optimizedPrompt });
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
      return res.status(400).json({
        success: false,
        message: "email and imageUrl are required to save a selection.",
      });
    }

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

// ---------------------- GET USER GALLERY ----------------------
app.get("/gallery/:email", async (req, res) => {
  try {
    const email = req.params.email;
    console.log("Fetching gallery for email:", email);

    if (!email) {
      return res.status(400).json({ success: false, message: "Email required." });
    }

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

      const urlPreview = urlLength <= 100 ? urlValue : urlValue.substring(0, 50) + "...";

      console.log(
        `Processing doc ${doc.id}, has url: ${!!data.url}, url length: ${urlLength}, url value: "${urlPreview}"`
      );

      if (
        urlValue &&
        urlValue.length > 50 &&
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

// ---------------------- START SERVER ----------------------
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});
