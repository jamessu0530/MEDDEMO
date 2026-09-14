# 第一階段打包 React，第二階段只留 Nginx 和打包結果，映像檔裡不帶 node_modules
FROM node:24.21.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.30.4-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
