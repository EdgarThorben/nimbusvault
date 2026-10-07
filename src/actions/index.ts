import { demoLogin, login, logout } from "./auth";
import {
  checkIn,
  createInvoice,
  decideApproval,
  deletePhoto,
  saveEstimate,
  saveFindings,
  sendForApproval,
  setStatus,
  uploadPhoto,
} from "./workshop";

export const server = {
  login,
  demoLogin,
  logout,
  checkIn,
  uploadPhoto,
  deletePhoto,
  saveFindings,
  saveEstimate,
  setStatus,
  sendForApproval,
  decideApproval,
  createInvoice,
};
