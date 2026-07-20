/**
 * Shared command result type.
 *
 * Application services run the full idempotency flow (claim -> execute ->
 * terminalize) and return a CommandResult. The future transport layer maps
 * this to an HTTP envelope (§2.3, §4).
 *
 * - executed: business facts committed; success receipt in same transaction.
 * - replayed_success: terminal succeeded record replayed; limited receipt (no body).
 * - in_progress: same key+hash still executing (HTTP 202).
 * - conflict: same key, different request hash (409 idempotency_key_reused).
 * - failed: business validation failure; terminal failed receipt recorded.
 */
import type { ResultResourceType } from "../../contracts/registries.ts";
import type { FieldError } from "../../contracts/envelope.ts";

export type CommandResult<T> =
  | {
      readonly kind: "executed";
      readonly httpStatus: number;
      readonly resultResourceType: ResultResourceType;
      readonly resultResourceId: string;
      readonly data: T;
      readonly recordId: string;
    }
  | {
      readonly kind: "replayed_success";
      readonly httpStatus: number;
      readonly resultResourceType: ResultResourceType;
      readonly resultResourceId: string;
      readonly recordId: string;
    }
  | {
      readonly kind: "in_progress";
      readonly recordId: string;
    }
  | {
      readonly kind: "conflict";
      readonly recordId: string;
    }
  | {
      readonly kind: "failed";
      readonly httpStatus: number;
      readonly errorCode: string;
      readonly errorSummary: string;
      readonly fieldErrors: readonly FieldError[];
      readonly recordId: string;
    };

/** HTTP 202 for in-progress (§4). */
export const IN_PROGRESS_HTTP_STATUS = 202;
