# Nyx

Nyx is a Node.js web application with an embedded Wisp WebSocket server.

## Run locally

```powershell
npm ci
npm start
```

Open `http://localhost:8080`. Verify the server at `http://localhost:8080/healthz`.

## Check a deployment

```powershell
npm run check:deploy
```

## Deploy to OVHcloud

Follow [DEPLOYMENT.md](DEPLOYMENT.md). The production setup uses one Ubuntu VPS, Nginx, systemd, and the embedded Wisp server.
