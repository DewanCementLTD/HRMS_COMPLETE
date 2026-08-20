import dotenv from 'dotenv';
dotenv.config();

/**
 * Server-side face guard for attendance marking.
 *
 * Faithful port of the FastAPI LMS-Backend's services/face_verification_service.py.
 *
 * /auth/attendance/face used to mark whatever card_no it was handed and never
 * looked at the face. In the kiosk ("mark attendance outside the app") flow the
 * app may pre-fill a previously-logged-in card, so a different person scanning
 * their face got the wrong person marked.
 *
 * Rule: the FACE is the source of truth — mark whoever was just scanned, not
 * whatever card the client sent. This helper asks the 8002 face service to
 * IDENTIFY the person from the submitted frames (1:N), and the caller marks that
 * identified card, ignoring the client-supplied card_no.
 *
 * Fail-closed: if the face service is unreachable/errors, or the face can't be
 * identified with confidence, no one is marked (the mark is rejected and can be
 * retried) rather than falling back to the untrusted client card.
 */

import { logger } from '../utils/logger.js';

// Minimum frames /face/identify needs to attempt a match (mirrors api.py's check).
const MIN_FRAMES = 5;
const TIMEOUT_MS = 20000;

const FACE_SERVICE_URL = process.env.FACE_SERVICE_URL || 'http://127.0.0.1:8002';
// console.log(process.env)
/**
 * Identify the person in the submitted frames via 8002 /face/identify.
 *
 * Returns { card_no, emp_name, reason }:
 *   - { card_no, emp_name, reason: "" } when a person is confidently identified.
 *   - { card_no: null, emp_name: null, reason } when there aren't enough frames,
 *     the service is unreachable, or the face isn't recognized.
 */
export const identifyScannedCard = async (frames) => {
  if (!Array.isArray(frames) || frames.length < MIN_FRAMES) {
    return {
      card_no: null,
      emp_name: null,
      reason: `too few frames for identification (need >= ${MIN_FRAMES})`,
    };
  }

  let body;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(`${FACE_SERVICE_URL}/face/identify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frames }),
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      body = json?.body ?? {};
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    logger.error({ err }, '[FACE_GUARD] identify call failed');
    return { card_no: null, emp_name: null, reason: 'face service unavailable' };
  }

  if (!body.identified) {
    return {
      card_no: null,
      emp_name: null,
      reason: body.message || 'face not recognized',
    };
  }

  return { card_no: body.card_no, emp_name: body.emp_name, reason: '' };
};
