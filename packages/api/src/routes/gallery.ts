import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { Actor } from "@cohory/authz";
import type { ManageService } from "@cohory/communities";
import { bodyLimit } from "hono/body-limit";

import type { ActorVariables } from "../middleware/session";
import { routeMeta } from "../route-meta";
import {
  addGalleryVideoBodySchema,
  galleryImageFormSchema,
  galleryJson,
  galleryParams,
  gallerySchema,
  reorderGalleryBodySchema,
  updateGalleryItemBodySchema,
} from "./gallery-schemas";
import { errorResponse, json, slugParams } from "./posts-schemas";

const jsonLimit = bodyLimit({ maxSize: 64 * 1024 });

const security = [{ sessionCookie: [] }];
const tags = ["Manage"];
const managers = " Admins and owners only.";
const base = "/communities/{slug}/manage/appearance/gallery";
const errors = {
  401: errorResponse("Sign in required."),
  403: errorResponse("The caller is not allowed to change the appearance of the community."),
  404: errorResponse("The community or gallery item does not exist or is not visible."),
  409: errorResponse("The community is archived."),
  422: errorResponse("The input is invalid, or the gallery already holds 10 items."),
};

function jsonBody<T>(schema: T) {
  return { body: { required: true, content: { "application/json": { schema } } } };
}

const addImage = createRoute({
  method: "post",
  path: `${base}/images`,
  operationId: "addCommunityGalleryImage",
  "x-cohory": routeMeta("addCommunityGalleryImage"),
  tags,
  security,
  summary: "Add a gallery image",
  description: `Accepts one PNG, JPEG, WebP, or GIF image in the \`file\` field, up to 10 MB, and optional \`altText\`. The image counts against the community's storage limit and is added at the end of the gallery.${managers}`,
  middleware: [bodyLimit({ maxSize: 10 * 1024 * 1024 + 64 * 1024 })] as const,
  request: {
    params: slugParams,
    body: {
      required: true,
      content: { "multipart/form-data": { schema: galleryImageFormSchema } },
    },
  },
  responses: { 201: json(gallerySchema, "The gallery after the change."), ...errors },
});

const addVideo = createRoute({
  method: "post",
  path: `${base}/videos`,
  operationId: "addCommunityGalleryVideo",
  "x-cohory": routeMeta("addCommunityGalleryVideo"),
  tags,
  security,
  summary: "Add a gallery video link",
  description: `Accepts a YouTube, Vimeo, or Loom link, stores it as the provider's embed URL, and adds it at the end of the gallery. Other hosts answer 422.${managers}`,
  middleware: [jsonLimit] as const,
  request: { params: slugParams, ...jsonBody(addGalleryVideoBodySchema) },
  responses: { 201: json(gallerySchema, "The gallery after the change."), ...errors },
});

const reorder = createRoute({
  method: "put",
  path: `${base}/order`,
  operationId: "reorderCommunityGallery",
  "x-cohory": routeMeta("reorderCommunityGallery"),
  tags,
  security,
  summary: "Reorder the gallery",
  description: `Sets the order of every gallery item in one change. The first item becomes the hero.${managers}`,
  middleware: [jsonLimit] as const,
  request: { params: slugParams, ...jsonBody(reorderGalleryBodySchema) },
  responses: { 200: json(gallerySchema, "The gallery after the change."), ...errors },
});

const updateItem = createRoute({
  method: "patch",
  path: `${base}/{itemId}`,
  operationId: "updateCommunityGalleryItem",
  "x-cohory": routeMeta("updateCommunityGalleryItem"),
  tags,
  security,
  summary: "Change the alt text of a gallery item",
  description: `Null or an empty string removes the alt text.${managers}`,
  middleware: [jsonLimit] as const,
  request: { params: galleryParams, ...jsonBody(updateGalleryItemBodySchema) },
  responses: { 200: json(gallerySchema, "The gallery after the change."), ...errors },
});

const removeItem = createRoute({
  method: "delete",
  path: `${base}/{itemId}`,
  operationId: "removeCommunityGalleryItem",
  "x-cohory": routeMeta("removeCommunityGalleryItem"),
  tags,
  security,
  summary: "Remove a gallery item",
  description: `Removes the item and deletes its stored image. The items after it move up.${managers}`,
  middleware: [jsonLimit] as const,
  request: { params: galleryParams },
  responses: { 200: json(gallerySchema, "The gallery after the change."), ...errors },
});

export function addGalleryRoutes(
  app: OpenAPIHono<{ Variables: ActorVariables }>,
  manage: () => ManageService,
  communityId: (caller: Actor, slug: string) => Promise<string>,
) {
  return app
    .openapi(addImage, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      const { file, altText } = c.req.valid("form");
      const items = await manage().addGalleryImage(
        caller,
        id,
        { bytes: new Uint8Array(await file.arrayBuffer()), declaredType: file.type },
        altText ?? null,
      );
      return c.json(galleryJson(items), 201);
    })
    .openapi(addVideo, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      return c.json(
        galleryJson(await manage().addGalleryVideo(caller, id, c.req.valid("json"))),
        201,
      );
    })
    .openapi(reorder, async (c) => {
      const caller = c.get("actor");
      const id = await communityId(caller, c.req.valid("param").slug);
      return c.json(
        galleryJson(await manage().reorderGallery(caller, id, c.req.valid("json"))),
        200,
      );
    })
    .openapi(updateItem, async (c) => {
      const caller = c.get("actor");
      const { slug, itemId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      const items = await manage().updateGalleryItem(caller, id, itemId, c.req.valid("json"));
      return c.json(galleryJson(items), 200);
    })
    .openapi(removeItem, async (c) => {
      const caller = c.get("actor");
      const { slug, itemId } = c.req.valid("param");
      const id = await communityId(caller, slug);
      return c.json(galleryJson(await manage().removeGalleryItem(caller, id, itemId)), 200);
    });
}
