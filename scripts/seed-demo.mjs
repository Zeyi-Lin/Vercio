import { createVercioApp } from "../server/index.js";

const app = await createVercioApp({});
try {
  const project = await app.projects.createDemo();
  console.log("Demo project ready: " + project.name + " (" + project.id + ")");
  console.log("Repository: " + project.repoPath);
  console.log("Start the app with: npm start");
} finally {
  app.store.flush();
  process.exit(0);
}
