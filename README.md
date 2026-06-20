# UG Hub

The official UG website — homepage, wiki, accounts, and admin tools.

## Tech stack
- React 18 + Vite
- Supabase (auth + database) — connected directly via `fetch()`, no SDK needed

## Project structure
```
ug-hub/
├── index.html        ← page shell, loads fonts
├── package.json       ← dependencies
├── vite.config.js     ← build config
└── src/
    ├── main.jsx        ← mounts the app
    └── App.jsx          ← everything else (homepage, wiki, auth, editor)
```

## Deploying (Vercel + GitHub)

1. Create a new repository on GitHub and upload all the files in this project,
   keeping the folder structure intact (the `src` folder must stay a folder).
2. Go to vercel.com, sign in (you can use your GitHub account to sign in directly),
   and click "Add New Project".
3. Select the repository you just created. Vercel will auto-detect this as a
   Vite project — no settings need to change. Click Deploy.
4. After a minute or two, you'll get a live URL like `ug-hub.vercel.app`.

## Making future updates

Once connected, any time new files are uploaded to the GitHub repository,
Vercel automatically rebuilds and redeploys the live site within a minute or
two — no manual redeploy needed.

## Adding a custom domain

In the Vercel project dashboard, go to Settings → Domains, and add your domain
there. Vercel will give you DNS records to add at wherever the domain was
purchased (e.g. Namecheap, GoDaccy, Google Domains). This usually takes a few
minutes to a few hours to fully activate.

## Admin setup (one-time)

1. Sign up for an account on the live site using the email/password form,
   choosing your desired admin username.
2. In the Supabase dashboard, go to SQL Editor → New query, and run:
   ```sql
   update public.profiles set role = 'admin' where username = 'YOUR_USERNAME';
   ```
3. Log out and back in on the site. You should now see Admin options in the menu.
