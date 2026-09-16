import { demoLogin, login, logout } from "./auth";
import { addItemRelationship, archiveItem, createItem, updateItem } from "./items";
import { createCollection } from "./collections";
import { createCredential, revealCredential } from "./credentials";
import { suggestNormalization } from "./normalization";
import { applyIngestEvent, rejectIngestEvent } from "./ingest";

export const server = {
  login,
  logout,
  demoLogin,
  createItem,
  updateItem,
  archiveItem,
  addItemRelationship,
  createCollection,
  createCredential,
  revealCredential,
  suggestNormalization,
  applyIngestEvent,
  rejectIngestEvent,
};
