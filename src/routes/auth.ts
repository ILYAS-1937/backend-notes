import express from 'express';
import { PrismaClient, Role, TypeEvaluation } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const router = express.Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'votre_cle_secrete_super_securisee';

/* ==========================================================================
   1. ROUTE D'INITIALISATION AUTOMATIQUE DES 8 FILIÈRES
   ========================================================================== */
router.post('/setup-academic', async (req, res) => {
  try {
    const filieresENSA = [
      "API1",
      "API2",
      "Génie Informatique",
      "Ingénierie de L'Aéronautique",
      "Ingénierie des Systèmes d'Information Et Big Data",
      "Génie Energétique et Environnement",
      "Génie Mécatronique et Systèmes Intelligents",
      "Automobile et Solutions Digitales"
    ];

    let ajoutees = 0;

    for (const nom of filieresENSA) {
      const existe = await prisma.filiere.findFirst({ where: { nomFiliere: nom } });
      if (!existe) {
        await prisma.filiere.create({ data: { nomFiliere: nom } });
        ajoutees++;
      }
    }

    res.json({ 
      message: "Initialisation terminée !", 
      totalFilieres: filieresENSA.length,
      nouvellesAjoutees: ajoutees 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erreur: "Erreur lors de l'initialisation des filières." });
  }
});
/* ==========================================================================
   ROUTE DE NETTOYAGE COMPLET (SÉCURISÉE)
   ========================================================================== */
/* ==========================================================================
   ROUTE DE NETTOYAGE COMPLET (ORDRE SÉCURISÉ AVEC SEMESTRES)
   ========================================================================== */
router.post('/reset-database', async (req, res) => {
  try {
    // 1. Supprimer les notes et les absences (dépendances directes)
    await prisma.note.deleteMany({});
    await prisma.absence.deleteMany({});

    // 2. Supprimer les matières
    await prisma.matiere.deleteMany({});

    // 3. Supprimer les modules
    await prisma.module.deleteMany({});

    // 4. Supprimer les semestres (L'élément qui manquait !)
    await prisma.semestre.deleteMany({});

    // 5. Supprimer tous les utilisateurs SAUF les administrateurs
    await prisma.utilisateur.deleteMany({
      where: {
        NOT: { role: 'ADMIN' }
      }
    });

    // 6. Détacher l'admin de toute filière restante
    await prisma.utilisateur.updateMany({
      where: { role: 'ADMIN' },
      data: { filiereId: null }
    });

    // 7. Supprimer enfin toutes les filières en toute sécurité
    await prisma.filiere.deleteMany({});

    res.json({ 
      message: "Base de données vidée avec succès ! Seul le compte ADMIN a été conservé." 
    });
  } catch (error) {
    console.error("Détails du crash de nettoyage :", error);
    res.status(500).json({ erreur: "Erreur lors du nettoyage de la base de données." });
  }
});
/* ==========================================================================
   2. AUTHENTIFICATION & CONNEXION
   ========================================================================== */
router.post('/register', async (req, res) => {
  try {
    const { nom, prenom, email, motDePasse, role, filiereId } = req.body;
    const existant = await prisma.utilisateur.findUnique({ where: { email } });
    if (existant) return res.status(400).json({ erreur: "Email déjà pris." });

    const salt = await bcrypt.genSalt(10);
    const hache = await bcrypt.hash(motDePasse, salt);

    const user = await prisma.utilisateur.create({
      data: { 
        nom, 
        prenom, 
        email, 
        motDePasse: hache, 
        role: role as Role,
        filiereId: filiereId ? parseInt(filiereId) : null
      }
    });
    res.status(201).json({ message: "Utilisateur créé", userId: user.id });
  } catch (error) {
    res.status(500).json({ erreur: "Erreur d'inscription." });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, motDePasse } = req.body;
    const user = await prisma.utilisateur.findUnique({ where: { email } });
    if (!user) return res.status(400).json({ erreur: "Identifiants invalides." });

    const valide = await bcrypt.compare(motDePasse, user.motDePasse);
    if (!valide) return res.status(400).json({ erreur: "Identifiants invalides." });

    const enseignement = await prisma.matiere.findFirst({ where: { professeurId: user.id } });
    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    
    res.json({ 
      token, 
      role: user.role, 
      nom: user.nom, 
      prenom: user.prenom, 
      id: user.id,
      matiereId: enseignement ? enseignement.id : null,
      filiereId: user.filiereId
    });
  } catch (error) {
    res.status(500).json({ erreur: "Erreur serveur login." });
  }
});

router.get('/users', async (req, res) => {
  try {
    const users = await prisma.utilisateur.findMany({
      include: { filiere: true, matieresEnseignees: true },
      orderBy: { role: 'asc' }
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ erreur: "Erreur liste utilisateurs." });
  }
});

/* ==========================================================================
   3. GRILLE DU PROFESSEUR (FILTRAGE, GESTION DES ABSENCES & JUSTIFICATIONS)
   ========================================================================== */
router.get('/professeur/:profId/resultats', async (req, res) => {
  try {
    const profId = parseInt(req.params.profId);
    if (isNaN(profId)) return res.status(400).json({ erreur: "ID invalide." });

    const prof = await prisma.utilisateur.findUnique({ where: { id: profId } });
    if (!prof || prof.role !== 'PROFESSEUR') return res.status(404).json({ erreur: "Professeur non trouvé." });

    const matiere = await prisma.matiere.findFirst({ where: { professeurId: profId } });

    if (!prof.filiereId || !matiere) {
      return res.json({ matiereId: null, nomMatiere: "Aucune matière assignée", etudiants: [] });
    }

    const etudiants = await prisma.utilisateur.findMany({
      where: { role: 'ETUDIANT', filiereId: prof.filiereId },
      include: {
        notesRecues: { where: { matiereId: matiere.id } },
        absences: { where: { matiereId: matiere.id } }
      },
      orderBy: { nom: 'asc' }
    });
    
    res.json({ matiereId: matiere.id, nomMatiere: matiere.nomMatiere, etudiants });
  } catch (error) {
    res.status(500).json({ erreur: "Erreur de filtrage." });
  }
});

router.post('/notes/save-single', async (req, res) => {
  try {
    const { valeur, typeEvaluation, etudiantId, matiereId } = req.body;
    const existante = await prisma.note.findFirst({
      where: { etudiantId: parseInt(etudiantId), matiereId: parseInt(matiereId), typeEvaluation: typeEvaluation as TypeEvaluation }
    });

    if (existante) {
      await prisma.note.update({ where: { id: existante.id }, data: { valeur: parseFloat(valeur) } });
    } else {
      await prisma.note.create({
        data: { valeur: parseFloat(valeur), typeEvaluation: typeEvaluation as TypeEvaluation, etudiantId: parseInt(etudiantId), matiereId: parseInt(matiereId) }
      });
    }
    res.json({ message: "Note sauvegardée" });
  } catch (error) {
    res.status(500).json({ erreur: "Erreur note." });
  }
});

router.post('/absences', async (req, res) => {
  try {
    const { etudiantId, matiereId } = req.body;
    await prisma.absence.create({
      data: { dateAbsence: new Date(), justifiee: false, etudiantId: parseInt(etudiantId), matiereId: parseInt(matiereId) }
    });
    res.status(201).json({ message: "+1h" });
  } catch (error) {
    res.status(500).json({ erreur: "Erreur +1h." });
  }
});

router.post('/absences/retirer', async (req, res) => {
  try {
    const { etudiantId, matiereId } = req.body;
    const derniere = await prisma.absence.findFirst({
      where: { etudiantId: parseInt(etudiantId), matiereId: parseInt(matiereId) },
      orderBy: { id: 'desc' }
    });
    if (!derniere) return res.status(400).json({ erreur: "Aucune absence." });
    await prisma.absence.delete({ where: { id: derniere.id } });
    res.json({ message: "-1h" });
  } catch (error) {
    res.status(500).json({ erreur: "Erreur -1h." });
  }
});

// NOUVEAU : Justifier 1 heure d'absence (Passer de NJ à J)
router.post('/absences/justifier', async (req, res) => {
  try {
    const { etudiantId, matiereId } = req.body;
    const absenceNonJustifiee = await prisma.absence.findFirst({
      where: { etudiantId: parseInt(etudiantId), matiereId: parseInt(matiereId), justifiee: false },
      orderBy: { id: 'asc' }
    });
    if (!absenceNonJustifiee) return res.status(400).json({ erreur: "Aucune heure non justifiée." });

    await prisma.absence.update({
      where: { id: absenceNonJustifiee.id },
      data: { justifiee: true }
    });
    res.json({ message: "1h justifiée" });
  } catch (error) {
    res.status(500).json({ erreur: "Erreur de justification." });
  }
});

// NOUVEAU : Rendre injustifiée 1 heure d'absence (Passer de J à NJ)
router.post('/absences/injustifier', async (req, res) => {
  try {
    const { etudiantId, matiereId } = req.body;
    const absenceJustifiee = await prisma.absence.findFirst({
      where: { etudiantId: parseInt(etudiantId), matiereId: parseInt(matiereId), justifiee: true },
      orderBy: { id: 'desc' }
    });
    if (!absenceJustifiee) return res.status(400).json({ erreur: "Aucune heure justifiée." });

    await prisma.absence.update({
      where: { id: absenceJustifiee.id },
      data: { justifiee: false }
    });
    res.json({ message: "1h injustifiée" });
  } catch (error) {
    res.status(500).json({ erreur: "Erreur modification justification." });
  }
});

/* ==========================================================================
   4. NOUVEAU : LOGIQUE AUTOMATIQUE DE RATTRAPAGE (< 12.00)
   ========================================================================== */
router.get('/rattrapages/liste-globale', async (req, res) => {
  try {
    const etudiants = await prisma.utilisateur.findMany({
      where: { role: 'ETUDIANT' },
      include: { filiere: true, notesRecues: { include: { matiere: true } } }
    });

    const listeRattrapages: any[] = [];

    etudiants.forEach(etudiant => {
      const matieresStructurees: { [key: string]: { CC?: number, TP?: number, EXAMEN_FINAL?: number } } = {};

      etudiant.notesRecues.forEach(n => {
        const nomMat = n.matiere.nomMatiere;
        if (!matieresStructurees[nomMat]) matieresStructurees[nomMat] = {};
        matieresStructurees[nomMat][n.typeEvaluation as 'CC' | 'TP' | 'EXAMEN_FINAL'] = n.valeur;
      });

      Object.keys(matieresStructurees).forEach(nomMat => {
        const data = matieresStructurees[nomMat];
        const cc = data.CC ?? 0;
        const tp = data.TP ?? 0;
        const exam = data.EXAMEN_FINAL ?? 0;
        const moyenne = parseFloat((cc * 0.3 + tp * 0.2 + exam * 0.5).toFixed(2));

        if (moyenne < 12.00) {
          listeRattrapages.push({
            idUnique: `${etudiant.id}-${nomMat}`,
            etudiantNom: `${etudiant.prenom} ${etudiant.nom}`,
            filiere: etudiant.filiere?.nomFiliere || "Génie Informatique",
            matiere: nomMat,
            moyenneActuelle: moyenne
          });
        }
      });
    });

    res.json(listeRattrapages);
  } catch (error) {
    res.status(500).json({ erreur: "Erreur lors de l'analyse des rattrapages." });
  }
});

/* ==========================================================================
   5. PANEL ADMIN & SUIVI ÉTUDIANT
   ========================================================================== */
router.get('/academic-structure', async (req, res) => {
  try {
    const filieres = await prisma.filiere.findMany();
    const modules = await prisma.module.findMany({ include: { semestre: true } });
    const matieres = await prisma.matiere.findMany({ include: { module: true } });
    res.json({ filieres, modules, matieres });
  } catch (error) {
    res.status(500).json({ erreur: "Erreur structure." });
  }
});

router.post('/matieres', async (req, res) => {
  try {
    // Le serveur reçoit maintenant directement l'ID de la filière sélectionnée
    const { nomMatiere, filiereId } = req.body; 

    if (!filiereId) {
      return res.status(400).json({ erreur: "Filière manquante." });
    }

    // 1. Vérifier si un Semestre existe pour cette filière, sinon le créer automatiquement
    let semestre = await prisma.semestre.findFirst({
      where: { filiereId: parseInt(filiereId) }
    });
    if (!semestre) {
      semestre = await prisma.semestre.create({
        data: { nomSemestre: "S1", filiereId: parseInt(filiereId) }
      });
    }

    // 2. Vérifier si un Module existe pour ce semestre, sinon le créer automatiquement
    let moduleParent = await prisma.module.findFirst({
      where: { semestreId: semestre.id }
    });
    if (!moduleParent) {
      moduleParent = await prisma.module.create({
        data: { nomModule: "Module Général", semestreId: semestre.id }
      });
    }

    // 3. Créer la matière finale rattachée de manière sécurisée
    const nouvelleMatiere = await prisma.matiere.create({
      data: { 
        nomMatiere, 
        moduleId: moduleParent.id, 
        coefficient: 1.0 
      }
    });

    res.status(201).json(nouvelleMatiere);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erreur: "Impossible de générer la structure de la matière." });
  }
});

router.post('/users/assign-prof', async (req, res) => {
  try {
    const { professeurId, filiereId, matiereId } = req.body;
    await prisma.utilisateur.update({ where: { id: parseInt(professeurId) }, data: { filiereId: parseInt(filiereId) } });
    await prisma.matiere.update({ where: { id: parseInt(matiereId) }, data: { professeurId: parseInt(professeurId) } });
    res.json({ message: "Affectation réussie" });
  } catch (error) {
    res.status(500).json({ erreur: "Erreur affectation." });
  }
});

router.get('/notes/mes-notes/:etudiantId', async (req, res) => {
  try {
    const notes = await prisma.note.findMany({ where: { etudiantId: parseInt(req.params.etudiantId) }, include: { matiere: true } });
    res.json(notes);
  } catch (error) {
    res.status(500).json({ erreur: "Erreur bulletins." });
  }
});

router.get('/absences/mes-absences/:etudiantId', async (req, res) => {
  try {
    const absences = await prisma.absence.findMany({ where: { etudiantId: parseInt(req.params.etudiantId) }, include: { matiere: true }, orderBy: { id: 'desc' } });
    res.json(absences);
  } catch (error) {
    res.status(500).json({ erreur: "Erreur absences." });
  }
});

export default router;