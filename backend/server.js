require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const admin = require("firebase-admin");

// node-fetch v3 is ESM; wrapper for CommonJS
const fetch = (...args) => import("node-fetch").then(({ default: fetchFn }) => fetchFn(...args));

const serviceAccount = require("./config/serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: serviceAccount.project_id,
});

const db = admin.firestore();
const app = express();

// ---------------------- MIDDLEWARE ----------------------
app.use(
  cors({
    origin: "https://stage-ghofrane.web.app", // URL front Firebase
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    credentials: true,
  })
);
app.use(bodyParser.json({ limit: "50mb" })); // Large payloads for multiple images

const SECRET_KEY = process.env.SECRET_KEY || "supersecret";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const MAX_IMAGES = 4;

const clampNumberOfImages = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(Math.max(Math.round(numeric), 1), MAX_IMAGES);
};

// ---------------------- IMAGE GENERATION ----------------------
const generateImagesWithGemini = async (finalPrompt, photos, numberOfImages) => {
  const generateSingleImage = async () => {
    let lastError;

    for (let attempt = 1; attempt <= 2; attempt++) {
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
                    ...photos.map((p) => {
                      let mimeType = "image/png";
                      if (p.startsWith("/9j/")) mimeType = "image/jpeg";
                      else if (p.startsWith("iVBORw0KGgo")) mimeType = "image/png";
                      return { inline_data: { mime_type: mimeType, data: p } };
                    }),
                  ],
                },
              ],
            }),
          }
        );

        const data = await response.json();
        if (data.error) throw new Error(data.error.message || "Generation failed");

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

        if (!imageUrl) throw new Error("No image found in response");
        return imageUrl;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error("Image generation failed");
  };

  const safeCount = clampNumberOfImages(numberOfImages);
  const imagePromises = Array.from({ length: safeCount }, () => generateSingleImage());
  return Promise.all(imagePromises);
};

// ---------------------- FIRESTORE SAVE ----------------------
const saveImagesToFirestore = async (email, imageUrls, metadata = {}) => {
  try {
    for (const imageUrl of imageUrls) {
      let urlToSave = imageUrl;
      if (imageUrl.length > 800000) urlToSave = imageUrl.substring(0, 500000) + "...[truncated]";

      await db.collection("images").add({
        email: email || "anonymous",
        url: urlToSave,
        created_at: new Date(),
        originalLength: imageUrl.length,
        ...metadata,
      });
    }
  } catch (e) {
    console.error("Firestore save error:", e?.message || e);
  }
};

// ---------------------- AUTH ROUTES ----------------------
app.post("/signup", async (req, res) => {
  try {
    const { email, nom, prenom, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: "Email and password required." });

    const userRef = db.collection("users").doc(email);
    const doc = await userRef.get();
    if (doc.exists) return res.json({ success: false, message: "User already exists." });

    const hashedPassword = await bcrypt.hash(password, 10);
    await userRef.set({ email, nom: nom || "", prenom: prenom || "", password_hash: hashedPassword, created_at: new Date() });
    res.json({ success: true, message: "Signup successful." });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error during signup." });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: "Email and password required." });

    const userRef = db.collection("users").doc(email);
    const doc = await userRef.get();
    if (!doc.exists) return res.json({ success: false, message: "User not found." });

    const userData = doc.data();
    const isMatch = userData.password_hash ? await bcrypt.compare(password, userData.password_hash) : password === userData.password;
    if (!isMatch) return res.json({ success: false, message: "Incorrect password." });

    const token = jwt.sign({ email }, SECRET_KEY, { expiresIn: "1h" });
    res.json({ success: true, message: "Login successful.", token, nom: userData.nom || "", prenom: userData.prenom || "" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error during login." });
  }
});

// ---------------------- DELETE PROFILE ----------------------
app.delete("/delete/:email", async (req, res) => {
  try {
    const email = req.params.email;
    if (!email) return res.status(400).json({ success: false, message: "Email required." });

    await db.collection("users").doc(email).delete();
    const imagesSnapshot = await db.collection("images").where("email", "==", email).get();
    const batch = db.batch();
    imagesSnapshot.forEach((docItem) => batch.delete(db.collection("images").doc(docItem.id)));
    await batch.commit();

    res.json({ success: true, message: "Profile and photos deleted successfully." });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error during deletion." });
  }
});

// ---------------------- IMAGE GENERATION ROUTES ----------------------
app.post("/generate", async (req, res) => {
  try {
    const { email, style, photos, numberOfImages } = req.body;
    if (!process.env.GOOGLE_API_KEY) return res.status(500).json({ success: false, message: "Missing GOOGLE_API_KEY" });
    if (!style || !Array.isArray(photos) || photos.length === 0) return res.status(400).json({ success: false, message: "Style and photos array required" });

    const finalPrompt = `Generate a ${style} portrait of the user. Be faithful to the original face and clothing.`;
    const safeNumberOfImages = clampNumberOfImages(numberOfImages || 4);
    const imageUrls = await generateImagesWithGemini(finalPrompt, photos, safeNumberOfImages);
    await saveImagesToFirestore(email, imageUrls, { prompt: finalPrompt, style, photosCount: photos.length });

    res.json({ success: true, imageUrls, prompt: finalPrompt });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error during generation." });
  }
});

// ---------------------- GALLERY ----------------------
app.get("/gallery/:email", async (req, res) => {
  try {
    const email = req.params.email;
    if (!email) return res.status(400).json({ success: false, message: "Email required." });

    const imagesSnapshot = await db.collection("images").where("email", "==", email).get();
    const images = [];
    imagesSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.url && data.url.startsWith("data:image/")) images.push({ id: doc.id, url: data.url, style: data.style || "unknown", prompt: data.prompt || "", photosCount: data.photosCount || 1, created_at: data.created_at?.toDate() || new Date() });
    });

    images.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json({ success: true, images, count: images.length });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching gallery.", error: error.message });
  }
});

// ---------------------- DELETE SINGLE IMAGE ----------------------
app.delete("/image/:imageId", async (req, res) => {
  try {
    const imageId = req.params.imageId;
    if (!imageId) return res.status(400).json({ success: false, message: "Image ID required." });

    const imageRef = db.collection("images").doc(imageId);
    const imageDoc = await imageRef.get();
    if (!imageDoc.exists) return res.status(404).json({ success: false, message: "Image not found." });

    await imageRef.delete();
    res.json({ success: true, message: "Image deleted successfully." });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting image." });
  }
});

// ---------------------- SERVER START ----------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running at http://localhost:${PORT}`));
