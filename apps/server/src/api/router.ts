import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform";
import { Effect } from "effect";
import { handleAuth } from "@/modules/auth/route";
import {
  createBookmark,
  deleteBookmark,
  listBookmarks,
} from "@/modules/annotations/routes/bookmarks";
import {
  createHighlight,
  deleteHighlight,
  listHighlights,
  updateHighlight,
} from "@/modules/annotations/routes/highlights";
import { POST as createIllustration } from "@/modules/ai/routes/illustrations";
import { POST as compactRealtime } from "@/modules/ai/routes/compaction";
import { POST as createRealtimeSession } from "@/modules/ai/routes/realtime";
import {
  GET as listBooks,
  POST as beginBookUpload,
} from "@/modules/books/routes/collection";
import { POST as completeBook } from "@/modules/books/routes/completion";
import { GET as getBookFile } from "@/modules/books/routes/file";
import { POST as retryBookIndex } from "@/modules/books/routes/index";
import { GET as getBook, PATCH as updateBook } from "@/modules/books/routes/item";
import { POST as searchBook } from "@/modules/books/routes/search";
import { GET as getHealth } from "@/modules/system/health";
import { apiError, HttpError } from "@/platform/http";

type WebHandler = (request: Request) => Promise<Response> | Response;

function adapt(handler: WebHandler) {
  return Effect.gen(function* () {
    const serverRequest = yield* HttpServerRequest.HttpServerRequest;
    const request = yield* HttpServerRequest.toWeb(serverRequest);
    const response = yield* Effect.tryPromise({
      try: () => Promise.resolve(handler(request)),
      catch: (error) => error,
    });
    return HttpServerResponse.fromWeb(response);
  }).pipe(
    Effect.catchAll((error) =>
      Effect.succeed(HttpServerResponse.fromWeb(apiError(error))),
    ),
  );
}

function adaptWithParams<const Keys extends readonly string[]>(
  keys: Keys,
  handler: (
    request: Request,
    context: { params: Promise<Record<Keys[number], string>> },
  ) => Promise<Response> | Response,
) {
  return Effect.gen(function* () {
    const serverRequest = yield* HttpServerRequest.HttpServerRequest;
    const route = yield* HttpRouter.RouteContext;
    const request = yield* HttpServerRequest.toWeb(serverRequest);
    const params: Record<string, string> = {};
    for (const key of keys) {
      const value = route.params[key];
      if (!value) {
        return HttpServerResponse.fromWeb(
          apiError(new HttpError(400, `Missing path parameter: ${key}.`)),
        );
      }
      params[key] = value;
    }
    const response = yield* Effect.tryPromise({
      try: () =>
        Promise.resolve(
          handler(request, {
            params: Promise.resolve(
              params as Record<Keys[number], string>,
            ),
          }),
        ),
      catch: (error) => error,
    });
    return HttpServerResponse.fromWeb(response);
  }).pipe(
    Effect.catchAll((error) =>
      Effect.succeed(HttpServerResponse.fromWeb(apiError(error))),
    ),
  );
}

const ready = Effect.sync(() =>
  HttpServerResponse.fromWeb(Response.json({ status: "ready" })),
);

const AuthRouter = HttpRouter.empty.pipe(
  HttpRouter.all("/api/auth/*", adapt(handleAuth)),
);

const SystemRouter = HttpRouter.empty.pipe(
  HttpRouter.get("/api/ready", ready),
  HttpRouter.get("/api/health", adapt(getHealth)),
);

const BooksRouter = HttpRouter.empty.pipe(
  HttpRouter.get("/api/books", adapt(listBooks)),
  HttpRouter.post("/api/books", adapt(beginBookUpload)),
  HttpRouter.get(
    "/api/books/:bookId",
    adaptWithParams(["bookId"], getBook),
  ),
  HttpRouter.patch(
    "/api/books/:bookId",
    adaptWithParams(["bookId"], updateBook),
  ),
  HttpRouter.post(
    "/api/books/:bookId/complete",
    adaptWithParams(["bookId"], completeBook),
  ),
  HttpRouter.post(
    "/api/books/:bookId/index",
    adaptWithParams(["bookId"], retryBookIndex),
  ),
  HttpRouter.get(
    "/api/books/:bookId/file",
    adaptWithParams(["bookId"], getBookFile),
  ),
  HttpRouter.post("/api/search", adapt(searchBook)),
);

const AnnotationsRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    "/api/books/:bookId/highlights",
    adaptWithParams(["bookId"], listHighlights),
  ),
  HttpRouter.post(
    "/api/books/:bookId/highlights",
    adaptWithParams(["bookId"], createHighlight),
  ),
  HttpRouter.patch(
    "/api/books/:bookId/highlights/:highlightId",
    adaptWithParams(["bookId", "highlightId"], updateHighlight),
  ),
  HttpRouter.del(
    "/api/books/:bookId/highlights/:highlightId",
    adaptWithParams(["bookId", "highlightId"], deleteHighlight),
  ),
  HttpRouter.get(
    "/api/books/:bookId/bookmarks",
    adaptWithParams(["bookId"], listBookmarks),
  ),
  HttpRouter.post(
    "/api/books/:bookId/bookmarks",
    adaptWithParams(["bookId"], createBookmark),
  ),
  HttpRouter.del(
    "/api/books/:bookId/bookmarks/:bookmarkId",
    adaptWithParams(["bookId", "bookmarkId"], deleteBookmark),
  ),
);

const AiRouter = HttpRouter.empty.pipe(
  HttpRouter.post("/api/illustrations", adapt(createIllustration)),
  HttpRouter.post("/api/realtime", adapt(createRealtimeSession)),
  HttpRouter.post("/api/realtime/compact", adapt(compactRealtime)),
);

export const ApiRouter = HttpRouter.concatAll(
  AuthRouter,
  SystemRouter,
  BooksRouter,
  AnnotationsRouter,
  AiRouter,
);
