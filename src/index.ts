import express, { Request, Response } from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';

dotenv.config();

const app = express();
export const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes);
app.get('/api/status', (req: Request, res: Response) => {
  res.json({ message: "L'API Massar Clone est en ligne 🚀", status: "OK" });
});

app.listen(PORT, () => {
  console.log(`✅ Serveur démarré avec succès sur http://localhost:${PORT}`);
});