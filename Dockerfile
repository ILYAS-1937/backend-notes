# Étape 1 : Build de l'application (Compilation TypeScript)
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
RUN npm run build

# Étape 2 : Exécution de l'application en mode léger
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
# Installe uniquement les dépendances nécessaires à la production
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
RUN npx prisma generate

# Hugging Face et les serveurs cloud injectent automatiquement la variable PORT
ENV PORT=7860
EXPOSE 7860

CMD ["npm", "run", "start"]