# zcode-web server image.
#
# The ZCode CLI bundle (zcode.cjs) is NOT redistributable and is therefore NOT
# in this repo. Either:
#   a) copy it to ./cli/zcode.cjs before building (it gets baked in), or
#   b) mount it at runtime:  ./cli/zcode.cjs:/opt/zcode/zcode.cjs:ro
# Get it from a local ZCode Desktop install, e.g. /opt/ZCode/resources/glm/zcode.cjs

FROM node:24-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ripgrep ca-certificates procps \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public

# CLI bundle staging (cli/ contains at least a README; zcode.cjs is optional)
RUN mkdir -p /opt/zcode /data/zcode /data/workspace
COPY cli/ /opt/zcode-staging/
RUN if [ -f /opt/zcode-staging/zcode.cjs ]; then mv /opt/zcode-staging/zcode.cjs /opt/zcode/zcode.cjs; fi \
 && rm -rf /opt/zcode-staging

# The CLI stores its state in ~/.zcode — point it at the data volume.
RUN ln -s /data/zcode /root/.zcode

ENV NODE_ENV=production \
    PORT=3000 \
    ZCODE_CLI_ENTRY=/opt/zcode/zcode.cjs \
    ZCODE_HOME=/data/zcode \
    ZCODE_WORKSPACE_ROOT=/data/workspace

VOLUME ["/data/zcode", "/data/workspace"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
