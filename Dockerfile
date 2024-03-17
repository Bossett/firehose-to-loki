FROM node:21 AS builder
RUN mkdir -p /app
WORKDIR /app
COPY . .
RUN yarn install
RUN yarn build

FROM node:21
COPY --from=builder /app/dist /app/dist
WORKDIR /app
COPY package.json entrypoint.sh .
RUN yarn install --production
EXPOSE 8080
CMD ["./entrypoint.sh"]