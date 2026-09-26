# Deploy Nyx to Netlify

The repository is configured to build the Nyx frontend into `dist`, run its HTTP routes as a Netlify Function, and use this Railway Wisp endpoint:

`wss://nyx-temporary-production.up.railway.app/wisp/`

## Deploy from GitHub

1. Commit and push the current project to the GitHub repository you want Netlify to use.
2. In Netlify, choose **Add new project > Import an existing project > GitHub**.
3. Select the Nyx repository.
4. Leave **Base directory** empty. Netlify reads the remaining settings from `netlify.toml`:
   - Build command: `npm run build:netlify`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
5. Choose **Deploy**.

## Allow the new site to use Railway Wisp

After Netlify assigns a URL such as `https://your-site.netlify.app`:

1. Open the Railway Wisp service.
2. Open **Variables**.
3. If `NYX_ALLOWED_ORIGINS` exists, add the exact Netlify origin without a trailing slash. Separate multiple origins with commas.
4. Redeploy the Railway service after saving the variable.

If `NYX_ALLOWED_ORIGINS` is empty or not defined, the Wisp currently accepts every browser origin, so this step is not required but restricting it is safer.

## Optional Nyx AI

In **Netlify > Site configuration > Environment variables**, add `NYX_AI_API_KEY` or `OPENROUTER_API_KEY`. Do not put the key in the repository.

## Link Generator accounts and daily limits

The Link Generator supports two access methods:

- A verified Firebase email/password account can create up to five links per UTC day.
- A Premium access code creates links without signing in and has no daily quota.

To enable free accounts:

1. In Firebase Console, open **Authentication > Sign-in method** and enable **Email/Password**.
2. Open **Firestore Database** and create a database. The server stores daily counters in the `nyxLinkGeneratorUsage` collection.
3. Open **Project settings > General** and copy the project's Web API key.
4. Open **Project settings > Service accounts**, generate a private key, and keep the downloaded JSON private.
5. In **Netlify > Project configuration > Environment variables**, add:
   - `FIREBASE_WEB_API_KEY`: the Web API key from step 3.
   - `FIREBASE_PROJECT_ID`: `project_id` from the service-account JSON.
   - `FIREBASE_CLIENT_EMAIL`: `client_email` from the service-account JSON.
   - `FIREBASE_PRIVATE_KEY`: `private_key` from the service-account JSON. Mark this variable as secret.
   - `BUNNY_API_KEY`: the Bunny account API key. Mark this variable as secret.
   - `LINK_GENERATOR_ACCESS_CODE`: the private Premium access code. Mark this variable as secret.
   - `NYX_PUBLIC_ORIGIN`: the official Nyx origin, for example `https://nyxlearning.netlify.app`.
6. Add the Netlify domain under **Firebase Authentication > Settings > Authorized domains**.
7. Trigger a new Netlify deploy after saving the variables.

Never add the service-account JSON, private key, Bunny key, or Premium access code to Git or frontend JavaScript. The Firebase Web API key is public configuration, but the other values are server-only secrets.

## Test the build locally

```powershell
npm ci
npm run build:netlify
npx netlify-cli build --offline
```

The build intentionally omits five bundled Minecraft HTML files larger than 10 MB because Netlify does not reliably deploy files above that size. Their entries are removed from the generated UGS catalog; the source files are not deleted.
