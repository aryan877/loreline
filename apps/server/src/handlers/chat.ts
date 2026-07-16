import { and, cosineDistance, desc, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { NextResponse } from "next/server";
import { bookChunks, conversations, messages } from "@loreline/database/schema";
import { chatInputSchema, chatResponseSchema } from "@loreline/contracts/ai";
import { ownedBook } from "@/book-utils";
import {
  apiError,
  assertRateLimit,
  HttpError,
  requireSession,
} from "@/http";
import {
  DatabaseService,
  OpenAIService,
  runServerEffect,
} from "@/services";
import {
  callChatModel,
  needsSecondaryBookContext,
} from "@/openai-contracts";

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    await assertRateLimit(`chat:${session.user.id}`, 60, 60 * 60 * 1000);
    const input = chatInputSchema.parse(await request.json());

    const result = await runServerEffect(
      Effect.gen(function* () {
        const book = yield* ownedBook(input.bookId, session.user.id);
        const { db } = yield* DatabaseService;
        const openai = yield* OpenAIService;
        if (!openai.client)
          return yield* Effect.fail(
            new HttpError(503, "Loreline AI is not available yet."),
          );

        let conversationId = input.conversationId;
        if (conversationId) {
          const existing = yield* Effect.tryPromise(() =>
            db
              .select({ id: conversations.id })
              .from(conversations)
              .where(
                and(
                  eq(conversations.id, conversationId!),
                  eq(conversations.userId, session.user.id),
                ),
              )
              .limit(1),
          );
          if (!existing.length)
            return yield* Effect.fail(
              new HttpError(404, "Conversation not found."),
            );
        } else {
          const [created] = yield* Effect.tryPromise(() =>
            db
              .insert(conversations)
              .values({
                bookId: book.id,
                userId: session.user.id,
                title: input.message.slice(0, 80),
              })
              .returning({ id: conversations.id }),
          );
          conversationId = created.id;
        }

        yield* Effect.tryPromise(() =>
          db.insert(messages).values({
            conversationId: conversationId!,
            role: "user",
            content: input.message,
            page: input.page,
            pointer: input.pointer,
          }),
        );

        const needsSecondaryContext = needsSecondaryBookContext(
          input.message,
          input.visibleText,
        );
        const queryEmbedding = needsSecondaryContext
          ? yield* Effect.tryPromise(() =>
              openai.client!.embeddings.create({
                model: openai.embeddingModel,
                input: input.message,
              }),
            )
          : null;
        const vector = queryEmbedding?.data[0]?.embedding;
        const similarity = vector
          ? sql<number>`1 - (${cosineDistance(bookChunks.embedding, vector)})`
          : sql<number>`0`;
        const relevant = vector
          ? yield* Effect.tryPromise(() =>
              db
                .select({
                  content: bookChunks.content,
                  pageStart: bookChunks.pageStart,
                  pageEnd: bookChunks.pageEnd,
                  similarity,
                })
                .from(bookChunks)
                .where(
                  and(
                    eq(bookChunks.bookId, book.id),
                    eq(bookChunks.userId, session.user.id),
                  ),
                )
                .orderBy(desc(similarity))
                .limit(6),
            )
          : [];

        const context = relevant
          .map(
            (chunk) =>
              `[Pages ${chunk.pageStart}-${chunk.pageEnd}] ${chunk.content}`,
          )
          .join("\n\n");
        const pointerDescription = input.pointer
          ? `The pointer is at normalized coordinates (${input.pointer.x.toFixed(3)}, ${input.pointer.y.toFixed(3)})${input.pointer.text ? ` near: “${input.pointer.text}”` : ""}.`
          : "No pointer location was provided.";
        const prompt = [
          `You are Loreline, an insightful reading companion for “${book.title}”${book.author ? ` by ${book.author}` : ""}.`,
          "Answer naturally and precisely. Ground claims in the supplied book excerpts. If the excerpts are insufficient, say so instead of inventing. Explain unfamiliar words in context. Use short paragraphs and mention page numbers when useful.",
          `The reader is on page ${input.page}. ${pointerDescription}`,
          input.visibleText ? `Visible page text:\n${input.visibleText}` : "",
          context
            ? `Secondary retrieved book context (use only if the visible page does not answer the question):\n${context}`
            : "",
          `Reader question: ${input.message}`,
        ]
          .filter(Boolean)
          .join("\n\n");

        const response = yield* Effect.tryPromise(() =>
          callChatModel(openai.client!, {
            model: openai.chatModel,
            prompt,
            screenshot: input.screenshot ?? undefined,
          }),
        );
        const answer =
          response.output_text ||
          "I couldn’t form an answer from this page yet.";
        const [saved] = yield* Effect.tryPromise(() =>
          db
            .insert(messages)
            .values({
              conversationId: conversationId!,
              role: "assistant",
              content: answer,
              page: input.page,
            })
            .returning({ id: messages.id, createdAt: messages.createdAt }),
        );
        return chatResponseSchema.parse({
          answer,
          conversationId,
          messageId: saved.id,
          createdAt: saved.createdAt.toISOString(),
        });
      }),
    );
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
