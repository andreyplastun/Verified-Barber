import "./lib/authFetch";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initializeClarity } from "./lib/clarity";

initializeClarity();
createRoot(document.getElementById("root")!).render(<App />);
