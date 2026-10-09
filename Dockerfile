# Stage 1: compile the app (dev dependencies needed for nest build + swc).
FROM node:24-alpine AS build
WORKDIR /app
ENV HUSKY=0
COPY package.json package-lock.json ./
RUN npm ci
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
# Emits dist/database/migrations/*.js, where data-source.ts looks at runtime.
RUN npm run build

# Stage 2: production dependencies only.
FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: the prepare script calls husky, a devDependency absent here;
# production dependencies need no install scripts.
# --omit=optional: typeorm's optional peer ts-node would otherwise pull
# typescript and @swc/core into the runtime; the app runs compiled JS only.
RUN npm ci --omit=dev --omit=optional --ignore-scripts

# Stage 3: runtime image. App files stay root-owned so the process cannot rewrite its code.
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4000
CMD ["node", "dist/main"]
