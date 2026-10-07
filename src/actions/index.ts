import { demoLogin, login, logout } from "./auth";
import {
  analyzeCheckIn,
  checkIn,
  createInvoice,
  decideApproval,
  deletePhoto,
  saveEstimate,
  saveFindings,
  sendForApproval,
  setStatus,
  suggestJob,
  uploadPhoto,
} from "./workshop";

export const server = {
  login,
  demoLogin,
  logout,
  analyzeCheckIn,
  checkIn,
  suggestJob,
  uploadPhoto,
  deletePhoto,
  saveFindings,
  saveEstimate,
  setStatus,
  sendForApproval,
  decideApproval,
  createInvoice,
};
