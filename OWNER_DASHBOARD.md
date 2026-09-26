# Nyx Owner Dashboard

The Owner Dashboard uses Firebase Authentication for account metadata and
Firestore for Nyx profiles, roles, subscriptions, activity, and audit events.
All privileged reads and mutations run through Firebase Admin on the Nyx
server. The browser never receives service-account credentials, passwords, or
stored authentication tokens.

## Required environment variables

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_WEB_API_KEY`
- `NYX_FOUNDER_PROFILE_ADMIN_UID`

`NYX_FOUNDER_PROFILE_ADMIN_UID` is the Firebase Authentication UID of the one
Owner account. The dashboard cannot demote, disable, or delete this account.

## Firestore collections

- `nyxUserAdministration`: role and subscription metadata
- `nyxUserProfiles`: public Nyx profile information
- `nyxUserActivity`: last-active and signed-in online timestamps
- `nyxAuditLog`: immutable server-written account and security activity
- `nyxUsernames`: atomic, server-written unique username claims

Firebase Authentication already prevents duplicate username-account emails.
The `nyxUsernames` registry also protects editable profile usernames with a
Firestore transaction, so simultaneous username changes cannot create a
duplicate.

Deploy the included rules to the same Firebase project:

```sh
firebase deploy --only firestore:rules
```

Netlify deployment does not deploy Firestore rules automatically.
