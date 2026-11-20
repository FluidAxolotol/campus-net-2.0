FROM node:24-alpine

WORKDIR /app

# 先只复制依赖清单，利用 Docker 层缓存
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3100
CMD ["npm", "start"]
