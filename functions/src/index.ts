import { initializeApp } from "firebase-admin/app";

initializeApp();

export { papersApi } from "./routes/papers.js";
export { projectsApi } from "./routes/projects.js";
export { deviceApi } from "./routes/device.js";
export { libraryApi } from "./routes/library.js";
export { usersApi } from "./routes/users.js";
