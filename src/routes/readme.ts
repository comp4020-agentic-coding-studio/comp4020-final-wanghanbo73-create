import { readFileSync } from "node:fs";
import { Router } from "express";
import { layout } from "../views/layout.ts";
import { readmePage } from "../views/readme.ts";
import { csrfToken } from "../csrf.ts";

export const readmeRouter = Router();

readmeRouter.get("/readme/", (req, res) => {
  const markdown = readFileSync("README.md", "utf8");
  res.send(
    layout({
      title: "README",
      user: req.session.user,
      csrfToken: csrfToken(req),
      body: readmePage(markdown),
    }),
  );
});
