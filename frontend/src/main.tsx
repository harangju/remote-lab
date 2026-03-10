import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ProjectList } from "./views/ProjectList";
import { ConvoList } from "./views/ConvoList";
import { Chat } from "./views/Chat";

function App() {
  return (
    <BrowserRouter basename="/chat">
      <Routes>
        <Route path="/" element={<ProjectList />} />
        <Route path="/p/:projectId" element={<ConvoList />} />
        <Route path="/p/:projectId/c/:convId" element={<Chat />} />
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
