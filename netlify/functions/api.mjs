// Netlify runs the existing Express routes as an on-demand function. The
// browser itself is served from the generated static `dist` directory.
let wrappedApp;

export async function handler(event, context) {
  if (!wrappedApp) {
    process.env.WISP_URL ||= "wss://nyx-temporary-production.up.railway.app/wisp/";
    const [{ default: serverless }, { app }] = await Promise.all([
      import("serverless-http"),
      import("../../server.js")
    ]);
    wrappedApp = serverless(app);
  }
  return wrappedApp(event, context);
}
