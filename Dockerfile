FROM node:20-alpine

# dossier de travail dans le container
WORKDIR /app

# copier uniquement les fichiers de dépendances
COPY package*.json ./

# installer les dépendances
RUN npm install

# copier le reste du projet
COPY . .

# exposer le port (à adapter si différent)
EXPOSE 3000

# lancer l'application
CMD ["node", "src/index.js"]
