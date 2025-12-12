import React, { useState } from "react";
import "./App.css";

function App() {
  const [mode, setMode] = useState("login");
  const [formData, setFormData] = useState({
    email: "",
    nom: "",
    prenom: "",
    password: "",
  });
  const [user, setUser] = useState(null);
  const [token, setToken] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [images, setImages] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [style, setStyle] = useState("professional_indoor");
  const [flowType, setFlowType] = useState("style"); // "style" | "auto"
  const [postText, setPostText] = useState("");
  const [postInputMode, setPostInputMode] = useState("manual"); // "select" | "manual"
  const [generatedPrompt, setGeneratedPrompt] = useState("");

  const predefinedPosts = [
    // ... tes posts prédéfinis (copier-coller depuis ton fichier actuel)
  ];

  const [numberOfImages, setNumberOfImages] = useState(3);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedImageIndex, setSelectedImageIndex] = useState(null);

  const API_BASE = "https://g-n-ration-ia-texte-image.vercel.app"; // <-- URL de ton back Vercel

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // ---------------- SIGNUP ----------------
  const handleSignup = async (e) => {
    e.preventDefault();

    const res = await fetch(`${API_BASE}/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });
    const data = await res.json();
    alert(data.message);
  };

  // ---------------- LOGIN ----------------
  const handleLogin = async (e) => {
    e.preventDefault();

    const res = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: formData.email, password: formData.password }),
    });

    const data = await res.json();

    if (data.success) {
      setUser({ email: formData.email, nom: data.nom, prenom: data.prenom });
      setToken(data.token);
    } else {
      alert("Login failed");
    }
  };

  // ---------------- UPLOAD PHOTOS ----------------
  const handleUpload = (event) => {
    const files = Array.from(event.target.files);
    const maxPhotos = flowType === "auto" ? 2 : 10;
    if (files.length + photos.length > maxPhotos) {
      alert(`You can upload a maximum of ${maxPhotos} photos for this mode.`);
      return;
    }
    setPhotos([...photos, ...files]);
  };

  const handleDeletePhoto = (index) => {
    const newPhotos = [...photos];
    newPhotos.splice(index, 1);
    setPhotos(newPhotos);
  };

  React.useEffect(() => {
    if (flowType === "auto") {
      if (photos.length > 2) setPhotos((prev) => prev.slice(0, 2));
      if (numberOfImages !== 2) setNumberOfImages(2);
    }
  }, [flowType, photos.length, numberOfImages]);

  // ---------------- GENERATE IMAGE ----------------
  const handleGenerate = async () => {
    if (photos.length === 0) return alert("Upload at least one photo");
    if (flowType === "style" && !style) return alert("Choose a style first");
    if (flowType === "auto") {
      if (!postText.trim()) return alert("Ajoute le texte du post pour générer un prompt.");
      if (photos.length < 1) return alert("Ajoute au moins 1 selfie (max 2) pour le mode auto-prompt.");
      if (photos.length > 2) return alert("Max 2 selfies en mode auto-prompt.");
    }

    setLoading(true);
    setImages([]);
    setGeneratedPrompt("");
    setSelectedImageIndex(null);
    setProgress(0);

    const progressInterval = setInterval(() => {
      setProgress((prev) => (prev >= 90 ? 90 : prev + 2));
    }, 100);

    const base64Photos = await Promise.all(
      photos.map(
        (file) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(",")[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          })
      )
    );

    try {
      const desiredCount = flowType === "auto" ? 2 : numberOfImages;
      const endpoint = flowType === "auto" ? "generate-auto" : "generate";
      const body = flowType === "auto"
        ? { email: user?.email || "anonymous", postText, photos: base64Photos, numberOfImages: desiredCount }
        : { email: user?.email || "anonymous", style, photos: base64Photos, numberOfImages: desiredCount };

      const res = await fetch(`${API_BASE}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      clearInterval(progressInterval);
      setProgress(100);

      if (data.success) {
        if (data.prompt) setGeneratedPrompt(data.prompt);
        else if (data.optimizedPrompt) setGeneratedPrompt(data.optimizedPrompt);

        if (data.imageUrls && Array.isArray(data.imageUrls)) {
          const unique = Array.from(new Set(data.imageUrls));
          const limited = unique.slice(0, desiredCount);
          setImages(limited);
        } else if (data.imageUrl || data.url) {
          setImages([data.imageUrl || data.url]);
        } else alert("Error: No images received");
      } else {
        alert("Error generating image: " + (data.message || "Unknown error"));
      }
    } catch (err) {
      console.error(err);
      clearInterval(progressInterval);
      alert("Server error");
    }

    setLoading(false);
    setTimeout(() => setProgress(0), 500);
  };

  // ---------------- SAVE SELECTION ----------------
  const handleSaveSelection = async () => {
    if (!user?.email) return alert("Connectez-vous pour sauvegarder une sélection.");
    if (selectedImageIndex === null) return alert("Choisissez d'abord une image.");
    const selectedUrl = images[selectedImageIndex];

    try {
      const res = await fetch(`${API_BASE}/selection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email, imageUrl: selectedUrl, prompt: generatedPrompt || style, flowType }),
      });

      const data = await res.json();
      alert(data.message || "Sélection enregistrée.");
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la sauvegarde.");
    }
  };

  // ---------------- DELETE ALL ----------------
  const handleDeleteAll = async () => {
    if (!user?.email) return alert("No user email found.");

    const res = await fetch(`${API_BASE}/delete/${user.email}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await res.json();
    alert(data.message);

    if (data.success) {
      setPhotos([]);
      setImages([]);
      setUser(null);
      setToken("");
    }
  };

  const handleLogout = () => {
    alert("You have been logged out.");
    setUser(null);
    setToken("");
  };

  // ---------------- DOWNLOAD IMAGE ----------------
  const handleDownloadImage = (imageUrl, index) => {
    const link = document.createElement("a");
    link.href = imageUrl;
    link.download = `generated-image-${index + 1}-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadAll = async () => {
    if (images.length === 0) return alert("No images to download.");
    for (let i = 0; i < images.length; i++) {
      handleDownloadImage(images[i], i);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  };

  const handleSelectImage = (index) => setSelectedImageIndex(index);

  // ---------------- RENDER ----------------
  return (
    <div className="container">
      {/* ... ton JSX actuel reste inchangé */}
    </div>
  );
}

export default App;
