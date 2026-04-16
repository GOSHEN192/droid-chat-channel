FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
COPY . .

# Data volume for sessions, reminders, whatsapp auth
VOLUME /app/data

# Default platform
ENV PLATFORM=telegram

CMD ["node", "index.js"]
