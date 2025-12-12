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

  // Posts LinkedIn prédéfinis pour les tests - Thèmes très différents
  const predefinedPosts = [
    {
      id: "corporate",
      title: "Corporate Formel (Bureau sérieux)",
      
      text: "J'ai animé mon 1er atelier LinkedIn en présentiel à Nantes... et ça a dépassé toutes mes attentes ! 🔥\n\nMardi dernier, j'étais à La Cantine X La French Tech Nantes pour atelier 100% LinkedIn, et l'énergie était au rendez-vous.\n\nCe qui m'a le plus marqué ?\n\nLa diversité des participants :\n\n→ Responsables Communication, commerciaux, consultants, dirigeants, etc.\n\n→ Agences, Startups, PME et organismes publics.\n\n→ Des profils LinkedIn allant de \"jamais publié\" à \"ultra actifs\"\n\nAu programme, on a passé en revue les 3 étapes indispensables pour performer sur LinkedIn :\n\n𝟭. \"𝗣𝗼𝘀𝗲 𝘁𝗮 𝗽𝗶𝗲𝗿𝗿𝗲\" : 𝗱𝗲́𝗳𝗶𝗻𝗶𝗿 𝘀𝗼𝗻 𝗽𝗼𝘀𝗶𝘁𝗶𝗼𝗻𝗻𝗲𝗺𝗲𝗻𝘁 & 𝘀𝗮 𝗹𝗶𝗴𝗻𝗲 𝗲́𝗱𝗶𝘁𝗼𝗿𝗶𝗮𝗹𝗲.\n\n• Les participants ont clarifié leur identité LinkedIn : cible, objectif et ligne édito.\n\n• L'exercice \"10 idées en 5 min\" leur a permis de débrider leur créativité.\n\n• BONUS : chacun est reparti avec la liste des 100 idées prêts à utiliser.\n\n𝟮. \"𝗟𝗲 𝗽𝗼𝘀𝘁 𝗾𝘂𝗶 𝗽𝗲𝗿𝗰𝘂𝘁𝗲\" : 𝗺𝗮𝗶̂𝘁𝗿𝗶𝘀𝗲𝗿 𝗹𝗲𝘀 𝗰𝗼𝗱𝗲𝘀 𝗱'𝘂𝗻 𝗯𝗼𝗻 𝗽𝗼𝘀𝘁.\n\n• Les 10 règles d'un contenu qui convertit.\n\n• Analyse de posts performants (et moins performants...) en direct sur LinkedIn.\n\n• Exercice d'écriture d'accroche en 60 secondes chrono.\n\n𝟯. \"𝗢𝗿𝗴𝗮𝗻𝗶𝘀𝗮𝘁𝗶𝗼𝗻 𝗲𝘁 𝗿𝗲́𝗴𝘂𝗹𝗮𝗿𝗶𝘁𝗲́\" : 𝗹𝗮 𝘀𝘁𝗿𝗮𝘁𝗲́𝗴𝗶𝗲 𝗰𝗼𝗻𝗰𝗿𝗲̀𝘁𝗲.\n\n• Identification des obstacles personnels à la publication.\n\n• Définition d'un rythme réaliste et d'un créneau dédié au batching.\n\n• Création d'un mini plan éditorial prêt à l'emploi.\n\nLe résultat ? Tout le monde est reparti avec :\n\n✅ Une ligne éditoriale claire et alignée avec ses objectifs\n\n✅ Des idées de posts exploitables immédiatement\n\n✅ Un système simple pour publier sans s'épuiser\n\nCerise sur la gâteau: les participants ont pu mettre en application tous ces conseils avec un outil clé en main...\n\nJ'ai nommé : Lyter 🔥\n\nL'outil leur a :\n\n1. Proposé des idées de posts ultra-personnalisés.\n\n2. Rédigé avec leurs style d'écriture en 30 sec.\n\n3. Programmé au meilleur moment sur leur compte.\n\n→ En 5 minutes, ils ont obtenus plusieurs posts prêts à publier 🙌\n\nUn grand merci à Emma VALLET et Alicia MARCHAND pour l'organisation de cet atelier à La Cantine Nantes !\n\nEt merci à tous les participants : Clémence Denigot, Emmanuelle Desaubliaux, Camille Peigné, Laurent Boisneau, Philippine Mahé, Guillaume PERDEREAU, Dr. HADJ-BACHIR Mokrane, Enora Bloc, Maelenn Le leu et Patrice Jadeau.\n\n Votre énergie et vos retours m'ont énormément touché 🙏"
    },
    {
      id: "atelier",
      title: "Atelier LinkedIn (Événement présentation)",
      text: "Mardi prochain, j'interviens à La Cantine X La French Tech Nantes. 🎤\n\n1h pour accélérer sur LinkedIn avec une méthode concrète ↓\n\nPour tous les acteurs BtoB, LinkedIn est INCONTOURNABLE en 2025.\n\nEn France, on compte 13 millions d'utilisateurs 😏\n\nMais quand on est indépendant ou dirigeant d'une petite entreprise, les mêmes questions reviennent toujours :\n\n→ Quelle est la bonne fréquence pour publier ?\n\n→ Comment trouver des idées de posts qui convertissent ?\n\n→ Comment créer du contenu pertinent sans y passer des heures ?\n\nPendant 1h, je vais vous partager une méthode concrète pour :\n\n✅ Définir votre ligne éditoriale qui convertit.\n\n✅ Trouver des idées de posts alignées avec votre expertise.\n\n✅ Créer du contenu percutant... sans y consacrer tout votre temps !\n\nC'est un atelier 100% pratique conçu pour vous faire gagner du temps et maximiser votre impact sur LinkedIn.\n\nL'atelier s'inscrit dans le cadre du Gang Communication & Marketing (réservés aux adhérents)\n\n👉 https://lnkd.in/eq_MYHa8\n\nLes infos pratiques :\n\n📆 2 décembre 2025. 11h30 - 12h30\n\n📍 La Cantine X La French Tech Nantes - 40 Rue la Tour d'Auvergne, 44200 Nantes.\n\nCet atelier fait suite au User Test de Lyter réalisé il y a quelques mois à La Cantine.\n\nAlban Le Bail, Molid NOUR AWALEH, Reine BOLOUNDZA, Ingrid Baudry, Jérôme LEPELLETIER, Marie Longépé, Ophélie Dos Santos, Juliette Roubaud, Jessy Martin, Loïc Renaud, Guillaume Parthenay.\n\nVos nombreuses questions sur LinkedIn nous ont donné l'idée de ce nouveau format.\n\nOn se retrouve mardi prochain ? 😉\n\nUn grand merci à Emma VALLET et Alicia MARCHAND pour l'organisation.\n\nCe atelier n'aurait pas été possible non plus sans l'Incubateur d'IMT Atlantique, adhérent à La Cantine X La French Tech Nantes. Merci pour cette opportunité !\n\nÀ mardi prochain ✌️"
    },
    {
      id: "live",
      title: "Live Solopreneur (Templates posts)",
      text: "Vendredi dernier, j'étais en live dans l'Incubateur Solopreneur de Flavie Prevot. 🎙️\n\nJ'y ai partagé 3 posts ultra-efficaces pour obtenir des clients :\n\nParce qu'on est d'accord : publier pour publier ne sert à rien.\n\nCe qui compte, c'est de transformer vos lecteurs en prospects, puis en clients.\n\nPendant 1h intense, j'ai partagé une méthode clé en main pour créer du contenu qui converti sans s'épuiser avec Lyter.\n\nJ'en ai profité pour livrer 3 templates de posts ultra-efficaces pour générer des leads sur LinkedIn :\n\n𝟭. 𝗟𝗲 𝘁𝗲𝗺𝗽𝗹𝗮𝘁𝗲 \"𝗔𝘃𝗶𝘀 𝗖𝗹𝗶𝗲𝗻𝘁\"\n\n• Récupérez un avis Google, LinkedIn ou même un message privé.\n\n• Copiez-le puis demandez à Lyter de rédiger un post en un clic.\n\n→ Résultat : un post avec de la preuve sociale ++ qui rassure vos prospects.\n\nASTUCE : prenez 10 avis et programmez 1 post par mois.\n\nEn 15 min, vous renforcez votre crédibilité sur le long terme.\n\n𝟮. 𝗟𝗲 𝘁𝗲𝗺𝗽𝗹𝗮𝘁𝗲 \"𝟯 𝗘𝗿𝗿𝗲𝘂𝗿𝘀 𝗙𝗿𝗲́𝗾𝘂𝗲𝗻𝘁𝗲𝘀\"\n\n• Listez 3 erreurs courantes dans votre domaine\n\n• Expliquez à Lyter comment les éviter (en montrant subtilement votre valeur)\n\n→ Résultat : vous démontrez votre expertise sans paraître arrogant\n\n𝟯. 𝗟𝗲 𝘁𝗲𝗺𝗽𝗹𝗮𝘁𝗲 \"𝗥𝗲𝗰𝘆𝗰𝗹𝗮𝗴𝗲 𝗱𝗲 𝗖𝗼𝗻𝘁𝗲𝗻𝘂\"\n\n• Récupérez un de vos contenus existants à haute valeur ajoutée : newsletter, article, podcast, vidéo, etc.\n\n• Donnez le à Lyter et obtenez un post de teasing en 30 sec.\n\n→ Résultat : vous convertissez vos lecteurs vers des contenus à forte valeur ajoutée.\n\nASTUCE : récupérez 10 contenus existants et recyclez en 1 par mois pour vos 10 prochains mois.\n\nÀ la fin du live, les participants sont repartis avec :\n\n✅ Des idées concrètes de posts qui convertissent.\n\n✅ 1 mois de posts déjà rédigés et prêts à l'emploi pour décembre.\n\n✅ Un système réplicable pour créer ses posts chaque mois en 30 min.\n\nHélène, Augustin, Claire, Priscillia, Sébastien, Léa, Adeline, Christophe Chol, Myriam, Amélie, Cécilia, Charlène, Elisabeth, Emmanuelle, Florie, Julie, Laura, Marine, Mélanie, Nicolas, Séverine et Slanie.\n\nMerci à tous pour votre engagement et votre énergie 🙌\n\nBONUS : pour tous les membres de l'Incubateur Solopreneur, vous bénéficiez d'1 MOIS OFFERT sur Lyter.\n\n→ Ne laissez pas passer cette offre (valable jusqu'au 28/11 à 23h59).\n\nUn immense merci à Flavie Prevot et Marine Aubonnet👩🏻‍🎤 pour l'organisation de ce live qui a fait carton plein.\n\nVotre communauté est incroyable de bienveillance et de motivation 💜"
    },
    {
      id: "creator",
      title: "Paris Creator Week (Événement Station F)",
      text: "J'ai été invité à la Paris Creator Week à STATION F ! 🔥\n\nLa Creator Economy explose et c'est le moment d'en faire partie.\n\nC'est l'ensemble des créateurs qui créent du contenu en ligne (Youtube, LinkedIn, Instagram, etc.).\n\nQuelques chiffres qui donnent le vertige :\n\n→ 250 milliards de dollars dans le monde\n\n→ 6,8 milliards en France\n\n→ +25% de croissance annuelle\n\n→ Un potentiel de 31 milliards de dollars et 300 000 créateurs actifs d'ici 3 ans\n\nUn écosystème ne peut pas grandir sans un événement pour se rencontrer, échanger et se structurer.\n\nC'est exactement ce que propose la Paris Creator Week.\n\nLes 9 et 10 décembre, Station F devient LE point de ralliement de tous les acteurs de la Creator Economy :\n\n4000 participants\n\n800 créateurs\n\n200 speakers\n\nUn événement MASSIF qui réunit les plus grands noms :\n\n→ Jean-Marc Jancovici, président de The Shift Project.\n\n→ Matthieu Stefani, créateur du podcast Génération Do It Yourself\n\n→ Jokariz, cofondateur de l'événement.\n\n→ James Grant (Mr Beast)\n\n→ Joyca\n\n→ Et bien d'autres...\n\nC'est le rendez-vous à ne pas manquer.\n\nEt Lyter sera de la partie.\n\nL'occasion notamment de :\n\n- Retrouver nos ambassadeurs Melinda, Aissa en physique cette fois ci ✌️\n\n- Découvrir les figures montantes de l'influence sur LinkedIn 💪\n\n- Nouer des partenariats stratégiques avec d'autres acteurs de l'écosystème 🤝\n\nPS : si tu veux venir, j'ai un code promo exclusif pour toi.\n\n→ Utilise \"PCW2K25\" pour obtenir -20% sur ton billet.\n\nÀ très vite sur place !"
    },
    {
      id: "entrepreneur",
      title: "Entrepreneuriat Étudiant (Conseil lancement)",
      text: "En 2020, j'ai lancé ma boite pendant mes études à IMT Atlantique.\n\nVoici le conseil que je donnerais à un étudiant qui veut se lancer :\n\nC'est simple :\n\nSOIS DÉBROUILLARD.\n\nN'attends pas qu'on t'apporte ce dont tu as besoin.\n\nComme disait un grand poète :\n\n\"Si tu veux faire des films, t'as juste besoin d'un truc qui filme.\n\nDire : « J'ai pas d'matos ou pas d'contact », c'est un truc de victime\"\n\nC'est exactement pareil pour créer sa boite :\n\nEn 2020, en plein confinement j'étais exactement à votre place.\n\nJe voulais créer une application mais :\n\n❌ Je ne savais pas coder\n\n❌ Je n'avais pas d'argent pour payer une agence\n\n❌ Je n'avais pas de réseau dans la tech\n\nPas le choix. J'ai appris à coder une appli de A à Z en regardant des tutos sur Udemy et YouTube.\n\nÇa m'a permis :\n\n→ De lancer la V1 de Metcher avant la fin du confinement.\n\n→ De tester rapidement le marché auprès de l'Icam - Institut Catholique d'Arts et Métiers (notre 1er client).\n\n→ D'acquérir une compétence cruciale qui m'a servi pour tous mes projets suivants.\n\nEt encore.\n\nAujourd'hui avec les outils comme bolt.new, Lovable, ou encore Cursor, c'est 10x plus simple de créer quelque chose sans compétence technique.\n\nLa création est plus accessible que jamais.\n\nC'est ce qu'on a utilisé pour développer la première version de Lyter rapidement.\n\nRésultat ?\n\n✅ Une version bêta sortie en 30 jours grâce au no-code.\n\n✅ Un outil capable de proposer des idées de posts LinkedIn ultra personnalisées et de les rédiger avec votre style d'écriture.\n\n✅ Plus de 2000 utilisateurs en un moins d'un an.\n\nSi tu es étudiant, sache que de nombreux dispositifs existent pour t'aider à lancer ta boîte :\n\n→ L'incubateur de ton école, comme l'Incubateur d'IMT Atlantique pour moi.\n\n→ Le réseau Pépite France - Le réseau des Étudiants-Entrepreneurs présent un peu partout en France.\n\n→ Des associations comme l'Association - Passeport Armorique pour Entreprendre, Entreprendre Pour Apprendre / JA France ou Les Entrep'​.\n\nVous avez une idée qui vous trotte dans la tête ?\n\nC'est LE moment de passer à l'action.\n\nLa meilleure façon d'apprendre, c'est de faire. 👊\n\n------------\n\nPS : Si tu me découvres avec ce post, je m'appelle Théo Fontenit 👋\n\nJe suis le cofondateur de Lyter, l'outil qui te permet de créer tes posts LinkedIn pour un mois entier, en seulement 30 min."
    },
    {
      id: "challenge",
      title: "Challenge Rentrée (Live formation)",
      text: "Le Challenge de rentrée commence aujourd'hui 🚨\n\nOn vous donne rendez-vous à 12h pour un live exceptionnel. ↓\n\nVous procrastinez sur LinkedIn ? Vous avez du mal à passer à l'action ?\n\nBonne nouvelle : on a LA solution pour vous.\n\nCe mardi 23 septembre à 12h, rejoignez notre live spécial rentrée et créez vos posts en direct.\n\nEn seulement 30 minutes, vous allez découvrir :\n\n→ La méthode complète pour créer du contenu qui performe sur LinkedIn\n\n→ Comment préparer 1 MOIS ENTIER de posts en 30 minutes chrono\n\n→ Les secrets d'une ligne éditoriale qui convertit\n\nLe plus fou ?\n\nVous repartirez avec :\n\n✅ 4 posts LinkedIn prêts à publier dès la fin du live\n\n✅ Une stratégie claire pour toute votre communication LinkedIn\n\n✅ Un max de motivation pour passer à l'action !\n\nPour participer, c'est simple :\n\n1. Bloquez 30 minutes dans votre agenda aujourd'hui à 12h (mettez une alarme pour y penser 🙃)\n\n2. Inscrivez-vous ici pour réserver votre place : https://lnkd.in/eU95mq4G\n\n3. Connectez-vous 5 minutes avant sur votre ordinateur.\n\nVous êtes +100 participants 🔥\n\nMarie, Jean-Marc, Frédéric, Carole, Anne, Laura, Hélène, Marjorie, Delphine, Olivier, Arnaud, Frederique, Coraline, Manon, Estelle, Geneviève, Soizic, Jonathan, Denis, Soumia et tous les autres...\n\nOn se retrouve en live à midi ✌️\n\n--------\n\nPS : Si vous me découvrez avec ce post, je m'appelle Théo Fontenit 👋\n\nJe suis le cofondateur de Lyter, l'outil qui vous permet de créer tous vos posts LinkedIn pour 1 mois entier en 30 min."
    },
    {
      id: "usertest",
      title: "User Test Lyter (Test produit)",
      text: "On a fait testé Lyter à 10 inconnus... et ils ont adoré ! 🔥\n\nJeudi dernier, nous avons organisé un User Test en partenariat avec La Cantine X La French Tech Nantes.\n\nLe principe est simple : mettre entre les mains de 10 inconnus un produit qu'ils ne connaissent pas.\n\nConcrètement :\n\n→ 10 participants aux profils variés viennent à la Halle 6 pour tester Lyter en live.\n\n→ Ils testent l'outil en toute liberté et repartent avec plusieurs posts prêts à publier.\n\n→ On observe et on pose des tonnes de questions pour recueillir un max de retours.\n\nRésultats, une mine d'or d'informations ultra qualitatives sur :\n\n• L'ergonomie de notre interface\n\n• L'expérience utilisateur globale\n\n• Les éventuels bugs ou points de friction\n\n• Les fonctionnalités les plus appréciées\n\nLes retours ont été fantastiques et nous donnent énormément de confiance pour la suite.\n\nVoici quelques verbatims qui nous ont particulièrement touchés :\n\n\"Jamais je n'aurais imaginé créer 4 posts aussi rapidement\"\n\n\"La qualité des textes est bluffante, on dirait vraiment mon style\"\n\n\"Enfin une solution qui comprend mes besoins en tant que freelance\"\n\nNotre produit s'améliore chaque semaine, et ça se ressent clairement dans vos retours.\n\nUn grand merci à tous les participants pour votre temps et vos précieux retours Alban Le Bail, Molid NOUR AWALEH, Reine BOLOUNDZA, Ingrid Baudry, Jérôme LEPELLETIER, Marie Longépé, Ophélie Dos Santos, Juliette Roubaud, Jessy Martin et Loïc Renaud 🫶\n\nUn grand merci aussi à la Cantine et à Emma VALLET pour l'organisation du User Test.\n\nCe test n'aurait pas été possible non plus sans l'Incubateur d'IMT Atlantique, adhérent à La Cantine Nantes. Merci pour cette opportunité !\n\nVous aussi, vous voulez tester Lyter et créer un mois entier de posts LinkedIn en 30 minutes ?\n\n👉 C'est par ici : https://www.lyter.ai/t\n\n---------\n\nPS : Si vous me découvrez avec ce post, je m'appelle Théo Fontenit 👋\n\nJe suis le cofondateur de Lyter, l'outil qui vous permet de créer tous vos posts LinkedIn pour 1 mois entier en 30 min."
    },
    {
      id: "anniversaire",
      title: "Anniversaire Lyter (Offre spéciale)",
      text: "Lyter souffle sa première bougie 👶\n\nPlus que 7 jours pour profiter de son cadeau d'anniversaire ↓\n\nComme vous le savez, Lyter a bien grandi.\n\nAujourd'hui, il est plus affûté que jamais :\n\n✅ Il a des idées de posts qui fusent à toute vitesse\n\n✅ Il écrit des posts LinkedIn comme un pro (déja +3000 posts écrits à son actif)\n\n✅ Il connaît LinkedIn comme sa poche et programme vos posts au meilleur moment.\n\nPour célébrer son anniversaire comme il se doit, on vous fait un cadeau :\n\n→ Nous vous offrons 200€ pour bénéficier de ses services 🎁\n\nL'offre est valable pendant 7 jours.\n\nEt en bonus, Lyter a décidé d'offrir 1 an d'abonnement à l'un d'entre vous.\n\nToutes les personnes qui souscrivent avant le 28/04 sont inscrites au tirage au sort pour gagner 1 an d'abonnement (valeur : 948€).\n\nLe tirage aura lieu lundi 28/04 à 12h en direct sur LinkedIn lors d'un événement spécial.\n\nAu programme de ce live :\n\n→ Découvrez les meilleurs hacks pour optimiser votre présence LinkedIn.\n\n→ Une session Q&R complète sur Lyter (posez-nous toutes vos questions !)\n\n→ Le tirage au sort en direct avec l'heureux gagnant\n\nPour participer, c'est simple :\n\n1. Bloquez 30 min dans votre agenda lundi prochain à 12h.\n\n2. Inscrivez-vous sur l'événement LinkedIn : https://lnkd.in/e4-cBbpd\n\n3. Préparez vos questions sur LinkedIn ou Lyter.\n\nLe nombre de places est limité, alors ne tardez pas.\n\nA lundi en live ✌️\n\n-----------\n\nPS : Si vous me découvrez avec ce post, je m'appelle Théo Fontenit 👋\n\nJe suis le cofondateur de Lyter, l'outil qui vous permet de créer tous vos posts LinkedIn pour 1 mois entier en 30 min.\n\nCe post a été rédigé par Lyter lui-même 👶"
    },
  ];

  const [numberOfImages, setNumberOfImages] = useState(3);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedImageIndex, setSelectedImageIndex] = useState(null);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // ---------------- SIGNUP ----------------
  const handleSignup = async (e) => {
    e.preventDefault();

  // ---------------- SIGNUP ----------------
const res = await fetch("https://g-n-ration-ia-texte-image-ro0va0afo-ghofranes-projects-1148fb18.vercel.app/signup", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify(formData),
});
const data = await res.json();
alert(data.message);

// ---------------- LOGIN ----------------
const handleLogin = async (e) => {
  e.preventDefault();

  const res = await fetch("https://g-n-ration-ia-texte-image-ro0va0afo-ghofranes-projects-1148fb18.vercel.app/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: formData.email,
      password: formData.password,
    }),
  });

  const data = await res.json();
  alert(data.message);
};

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

  // Ajustement auto-prompt
  React.useEffect(() => {
    if (flowType === "auto") {
      if (photos.length > 2) {
        setPhotos((prev) => prev.slice(0, 2));
      }
      if (numberOfImages !== 2) {
        setNumberOfImages(2);
      }
    }
  }, [flowType, photos.length, numberOfImages]);

  // ---------------- GENERATE IMAGE ----------------
  const handleGenerate = async () => {
    if (photos.length === 0) {
      alert("Upload at least one photo");
      return;
    }

    if (flowType === "style" && !style) {
      alert("Choose a style first");
      return;
    }

    if (flowType === "auto") {
      if (!postText.trim()) {
        alert("Ajoute le texte du post pour générer un prompt.");
        return;
      }
      if (photos.length < 1) {
        alert("Ajoute au moins 1 selfie (max 2) pour le mode auto-prompt.");
        return;
      }
      if (photos.length > 2) {
        alert("Max 2 selfies en mode auto-prompt.");
        return;
      }
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
            reader.onload = () =>
              resolve(reader.result.split(",")[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          })
      )
    );

    try {
      const desiredCount = flowType === "auto" ? 2 : numberOfImages;
      const endpoint = flowType === "auto" ? "generate-auto" : "generate";

      const body =
        flowType === "auto"
          ? {
              email: user?.email || "anonymous",
              postText,
              photos: base64Photos,
              numberOfImages: desiredCount,
            }
          : {
              email: user?.email || "anonymous",
              style,
              photos: base64Photos,
              numberOfImages: desiredCount,
            };

      const res = await fetch(`http://localhost:5000/${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      clearInterval(progressInterval);
      setProgress(100);

      if (data.success) {
        if (data.prompt) {
          setGeneratedPrompt(data.prompt);
        } else if (data.optimizedPrompt) {
          setGeneratedPrompt(data.optimizedPrompt);
        }

        if (data.imageUrls && Array.isArray(data.imageUrls)) {
          const unique = Array.from(new Set(data.imageUrls));
          const limited = unique.slice(0, desiredCount);
          setImages(limited);
        } else if (data.imageUrl || data.url) {
          setImages([data.imageUrl || data.url]);
        } else {
          alert("Error: No images received");
        }
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

  // ---------------- SAVE SELECTED IMAGE ----------------
  const handleSaveSelection = async () => {
    if (!user?.email) {
      alert("Connectez-vous pour sauvegarder une sélection.");
      return;
    }

    if (selectedImageIndex === null) {
      alert("Choisissez d'abord une image.");
      return;
    }

    const selectedUrl = images[selectedImageIndex];

    try {
      const res = await fetch("http://localhost:5000/selection", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: user.email,
          imageUrl: selectedUrl,
          prompt: generatedPrompt || style,
          flowType,
        }),
      });

      const data = await res.json();
      alert(data.message || "Sélection enregistrée.");
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la sauvegarde.");
    }
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
    if (images.length === 0) {
      alert("No images to download.");
      return;
    }
    for (let i = 0; i < images.length; i += 1) {
      handleDownloadImage(images[i], i);
      await new Promise((resolve) => setTimeout(resolve, 500)); // Delay to prevent browser blocking multiple downloads
    }
  };

  const handleSelectImage = (index) => {
    setSelectedImageIndex(index);
  };

  const handleDeleteAll = async () => {
    if (!user?.email) {
      alert("No user email found.");
      return;
    }

    const res = await fetch(`http://localhost:5000/delete/${user.email}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
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

  // ---------------- RENDER ----------------
  return (
    <div className="container">
      {!user ? (
        <>
          <h1 className="title">
            Welcome to Lyter – Create your professional photos ✨
          </h1>

          <div className="toggle">
            <button
              className={mode === "signup" ? "active" : ""}
              onClick={() => setMode("signup")}
            >
              Sign Up
            </button>
            <button
              className={mode === "login" ? "active" : ""}
              onClick={() => setMode("login")}
            >
              Login
            </button>
          </div>

          <form
            className="form"
            onSubmit={mode === "signup" ? handleSignup : handleLogin}
          >
            {mode === "signup" && (
              <>
                <input
                  type="text"
                  name="nom"
                  placeholder="Last Name"
                  value={formData.nom}
                  onChange={handleChange}
                  required
                />
                <input
                  type="text"
                  name="prenom"
                  placeholder="First Name"
                  value={formData.prenom}
                  onChange={handleChange}
                  required
                />
              </>
            )}

            <input
              type="email"
              name="email"
              placeholder="Email"
              value={formData.email}
              onChange={handleChange}
              required
            />

            <div className="password-container">
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                placeholder="Password"
                value={formData.password}
                onChange={handleChange}
                required
              />
              <button
                type="button"
                className="eye-btn"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? "🙈" : "👁️"}
              </button>
            </div>

            <button type="submit" className="submit-btn">
              {mode === "signup" ? "Sign Up" : "Login"}
            </button>
          </form>
        </>
      ) : (
        <div className="dashboard">
          <h2 className="welcome">
            Welcome {user.prenom} {user.nom} 🎉
          </h2>

          <div className="layout">
            {/* Left side */}
            <div className="upload-section">
              <h3>📤 Upload your photos (max 10)</h3>

              <div className="scenario-toggle">
                <button
                  className={flowType === "style" ? "active" : ""}
                  onClick={() => setFlowType("style")}
                >
                  Mode style prédéfini
                </button>
                <button
                  className={flowType === "auto" ? "active" : ""}
                  onClick={() => setFlowType("auto")}
                >
                  Mode auto-prompt (texte + selfies)
                </button>
              </div>

              <button
                className="btn"
                onClick={() =>
                  document.getElementById("galleryInput").click()
                }
              >
                🖼️ Choose from gallery
              </button>
              <input
                id="galleryInput"
                type="file"
                multiple
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleUpload}
              />

              <button
                className="btn"
                onClick={() =>
                  document.getElementById("cameraInput").click()
                }
              >
                📸 Take a photo
              </button>
              <input
                id="cameraInput"
                type="file"
                accept="image/*"
                capture="user"
                style={{ display: "none" }}
                onChange={handleUpload}
              />

              <p>{photos.length} / 10 photos uploaded</p>

              <div className="preview-grid">
                {photos.map((file, index) => (
                  <div key={index} className="preview-item">
                    <img
                      src={URL.createObjectURL(file)}
                      alt={`Uploaded ${index}`}
                      className="preview-img"
                    />
                    <button
                      className="remove-btn"
                      onClick={() => handleDeletePhoto(index)}
                    >
                      ❌
                    </button>
                  </div>
                ))}
              </div>

              <div className="style-select">
                <h4>🎨 Choose a style</h4>
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  disabled={flowType === "auto"}
                >
                  <option value="professional_indoor">
                    Professional Indoor
                  </option>
                  <option value="professional_outdoor">
                    Professional Outdoor
                  </option>
                  <option value="corporate_studio">Corporate Studio</option>
                  <option value="modern_workspace">Modern Workspace</option>
                  <option value="personal_office">Personal Office</option>
                  <option value="street">Street Casual</option>
                  <option value="working_computer">Working on Computer</option>
                  <option value="writing_notes">Writing Notes</option>
                  <option value="presenting_screen">
                    Presenting Screen
                  </option>
                  <option value="meeting">Meeting / Conference</option>
                  <option value="walking_street">Walking in the Street</option>
                  <option value="selfie_transport">
                    Selfie in Transport
                  </option>
                  <option value="selfie_office">Selfie at Office</option>
                  <option value="selfie_outdoor">Selfie Outdoor</option>
                  <option value="selfie_pointing">
                    Selfie Pointing Something
                  </option>
                  <option value="coffee_break">Coffee Break</option>
                  <option value="eating">Eating</option>
                  <option value="software_interface">
                    Software Interface
                  </option>
                  <option value="app_showcase">App Showcase</option>
                  <option value="digital_product_context">
                    Digital Product Context
                  </option>
                  <option value="product_neutral">
                    Product Neutral Background
                  </option>
                  <option value="product_real_context">
                    Product Real Context
                  </option>
                  <option value="product_used">Product Used</option>
                  <option value="mentor_leader">
                    Mentor / Leader Portrait
                  </option>
                  <option value="creative_portrait">
                    Creative Portrait
                  </option>
                  <option value="subtle_humor">Subtle Humor Scene</option>
                </select>

                {flowType === "auto" && (
                  <p className="disabled-hint">
                    Le style est désactivé en mode auto-prompt.
                  </p>
                )}
              </div>

              {flowType === "auto" && (
                <div className="post-text-block">
                  <h4>📝 Texte du post</h4>

                  <div className="post-input-toggle">
                    <button
                      type="button"
                      className={
                        postInputMode === "select" ? "active" : ""
                      }
                      onClick={() => {
                        setPostInputMode("select");
                      }}
                    >
                      📋 Choisir un post prédéfini
                    </button>

                    <button
                      type="button"
                      className={
                        postInputMode === "manual" ? "active" : ""
                      }
                      onClick={() => {
                        setPostInputMode("manual");
                      }}
                    >
                      ✏️ Saisir manuellement
                    </button>
                  </div>

                  {postInputMode === "select" && (
                    <select
                      value=""
                      onChange={(e) => {
                        const selectedPost = predefinedPosts.find(
                          (p) => p.id === e.target.value
                        );
                        if (selectedPost) {
                          setPostText(selectedPost.text);
                        }
                      }}
                      className="post-select"
                    >
                      <option value="">
                        -- Sélectionnez un post de test --
                      </option>
                      {predefinedPosts.map((post) => (
                        <option key={post.id} value={post.id}>
                          {post.title}
                        </option>
                      ))}
                    </select>
                  )}

                  <textarea
                    placeholder={
                      postInputMode === "select"
                        ? "Sélectionnez un post ci-dessus ou basculez en mode manuel pour écrire..."
                        : "Décris le post LinkedIn / Instagram..."
                    }
                    value={postText}
                    onChange={(e) => setPostText(e.target.value)}
                    className={
                      postInputMode === "select" && postText
                        ? "selected-post-textarea"
                        : ""
                    }
                  ></textarea>

                  <p className="hint">
                    Ajoute 1 à 2 selfies pour un prompt personnalisé.
                  </p>
                </div>
              )}

              <div className="images-count">
                <h4>🖼️ Nombre d'images</h4>
                <select
                  value={flowType === "auto" ? 2 : numberOfImages}
                  onChange={(e) =>
                    setNumberOfImages(
                      Math.min(
                        Math.max(parseInt(e.target.value, 10), 1),
                        4
                      )
                    )
                  }
                  disabled={flowType === "auto"}
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>

                {flowType === "auto" && (
                  <p className="hint">
                    Auto-prompt : 2 images générées, 1 à 2 selfies
                    max.
                  </p>
                )}
              </div>

              <button
                className="btn generate"
                onClick={handleGenerate}
                disabled={loading}
              >
                {loading ? "Generating..." : "🎨 Generate my image"}
              </button>

              {loading && (
                <div className="progress-container">
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${progress}%` }}
                    ></div>
                  </div>
                  <p className="progress-text">{progress}%</p>
                </div>
              )}
            </div>

            {/* Right side */}
            <div className="gallery">
              <h3>
                🖼️ Generated Images (
                {selectedImageIndex !== null ? 1 : images.length})
              </h3>

              <div className="gallery-grid">
                {selectedImageIndex !== null ? (
                  <div className="image-wrapper">
                    <img
                      key={selectedImageIndex}
                      src={images[selectedImageIndex]}
                      alt={`Selected ${selectedImageIndex + 1}`}
                      className="gallery-img selected"
                      onClick={() => setSelectedImageIndex(null)}
                      title="Click to show all images again"
                      onError={(e) => {
                        e.target.style.display = "none";
                        console.error(
                          "Image failed to load:",
                          images[selectedImageIndex]?.substring(0, 50)
                        );
                      }}
                    />
                    <button
                      className="download-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownloadImage(images[selectedImageIndex], selectedImageIndex);
                      }}
                      title="Télécharger cette image"
                    >
                      ⬇️ Télécharger
                    </button>
                  </div>
                ) : (
                  images.map((img, index) => (
                    <div key={index} className="image-wrapper">
                      <img
                        src={img}
                        alt={`Generated ${index + 1}`}
                        className="gallery-img clickable"
                        onClick={() => handleSelectImage(index)}
                        title="Click to select this image"
                        onError={(e) => {
                          e.target.style.display = "none";
                          console.error(
                            `Image ${index + 1} failed to load:`,
                            img?.substring(0, 50)
                          );
                        }}
                      />
                      <button
                        className="download-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownloadImage(img, index);
                        }}
                        title="Télécharger cette image"
                      >
                        ⬇️ Télécharger
                      </button>
                    </div>
                  ))
                )}

                {images.length === 0 && !loading && (
                  <p>
                    No images generated yet. Upload photos and click
                    generate!
                  </p>
                )}
              </div>

              {selectedImageIndex !== null && images.length > 1 && (
                <p className="selection-hint">
                  ✓ Image selected! Click on it to show all images
                  again.
                </p>
              )}

              {images.length > 0 && (
                <div className="gallery-actions">
                  <button
                    className="btn generate"
                    onClick={handleGenerate}
                    disabled={loading}
                  >
                    🔄 Régénérer
                  </button>

                  <button
                    className="btn save-btn"
                    onClick={handleSaveSelection}
                    disabled={selectedImageIndex === null || loading}
                  >
                    💾 Sauvegarder l'image sélectionnée
                  </button>

                  <button
                    className="btn download-all-btn"
                    onClick={handleDownloadAll}
                    disabled={loading}
                  >
                    ⬇️ Télécharger toutes les images
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="bottom-actions">
            <button className="btn delete" onClick={handleDeleteAll}>
              🗑️ Delete my profile
            </button>
            <button className="btn logout" onClick={handleLogout}>
              🚪 Logout
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
