import { extractExcerpt } from "@cohory/content";
import { levelFor, levelThresholds } from "@cohory/gamification";
import { maxCategories, maxPinnedPosts } from "@cohory/posts";
import { z } from "zod";

import type { ArchiveRecord, ArchiveRecords } from "../format/records";
import { maxSkippedListed } from "../import/summary";
import {
  importerCatalog,
  importerMaxComments,
  importerMaxMembers,
  importerMaxPosts,
  type ImporterId,
} from "./catalog";
import type { ConvertedText } from "./rich-text";
import type { DateOrder } from "./tabular";
import type {
  AmbiguousAuthor,
  AuthorCandidate,
  CategoryMapping,
  DetectedFile,
  ExistingCategory,
  ImporterContext,
  ImportReport,
  ReportedRow,
  RoleMapping,
  SamplePost,
  UnknownColumns,
} from "./types";

export type MemberRole = "admin" | "moderator" | "member";

export interface MemberInput {
  readonly file: string;
  readonly row: string;
  readonly email: string | null;
  readonly name: string | null;
  readonly sourceIds: readonly string[];
  readonly role: MemberRole;
  readonly sourceRole: string | null;
  readonly joinedAt: Date | null;
  readonly lastSeenAt: Date | null;
  readonly bio: string | null;
  readonly joinAnswers: readonly string[];
  readonly points: number | null;
  readonly wasPaying?: boolean;
  readonly values?: Readonly<Record<string, string>>;
}

export interface AuthorRef {
  readonly email?: string | null;
  readonly id?: string | null;
  readonly name?: string | null;
  readonly handle?: string | null;
}

export interface PostInput {
  readonly file: string;
  readonly row: string;
  readonly sourceKeys: readonly string[];
  readonly title: string | null;
  readonly body: ConvertedText;
  readonly author: AuthorRef;
  readonly category: string | null;
  readonly createdAt: Date | null;
  readonly updatedAt: Date | null;
  readonly pinned: boolean;
}

export interface CommentInput {
  readonly file: string;
  readonly row: string;
  readonly sourceKey: string | null;
  readonly postKey: string | null;
  readonly parentKey: string | null;
  readonly body: ConvertedText;
  readonly author: AuthorRef;
  readonly createdAt: Date | null;
  readonly updatedAt: Date | null;
}

const emailSchema = z.email().max(254);
const nameMax = 200;
const titleMax = 120;
const bioMax = 500;
const answerMax = 1000;
const categoryNameMax = 40;
const formerMemberName = "Former member";
const formerMemberMarker = " (former member)";
const mappingListed = 50;
export const maxAmbiguousListed = 100;
const sampleExcerptLength = 280;

function cut(value: string, max: number): string {
  return value.length > max ? value.slice(0, max).trimEnd() : value;
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug === "" ? "category" : slug;
}

function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

type PendingComment = CommentInput & { readonly id: string; readonly authorId: string };

export class RecordsBuilder {
  private readonly users: ArchiveRecord<"users">[] = [];
  private readonly memberships: ArchiveRecord<"memberships">[] = [];
  private readonly stats: ArchiveRecord<"member_stats">[] = [];
  private readonly categories: ArchiveRecord<"categories">[] = [];
  private readonly posts: ArchiveRecord<"posts">[] = [];
  private readonly comments: PendingComment[] = [];
  private readonly byEmail = new Map<string, string>();
  private readonly bySourceId = new Map<string, string>();
  private readonly byName = new Map<string, string[]>();
  private readonly candidates = new Map<string, AuthorCandidate>();
  private readonly formerMembers = new Map<string, string>();
  private readonly ambiguous = new Map<string, AmbiguousAuthor>();
  private readonly roles: RoleMapping[] = [];
  private readonly categoryMapping: CategoryMapping[] = [];
  private sample: SamplePost | null = null;
  private rolesTotal = 0;
  private dateOrder: DateOrder | null = null;
  private readonly categoryByName = new Map<string, string | null>();
  private readonly postByKey = new Map<string, string>();
  private readonly pinned: { id: string; createdAt: string }[] = [];
  private readonly warnings = new Set<string>();
  private readonly skipped: ReportedRow[] = [];
  private readonly unknown: UnknownColumns[] = [];
  private readonly files: (DetectedFile & { rows: number })[] = [];
  private readonly paying: string[] = [];
  private skippedTotal = 0;
  private droppedImages = 0;
  private truncated = 0;
  private titleOnly = 0;
  private newCategories = 0;
  private readonly existing: ReadonlyMap<string, ExistingCategory>;
  private readonly now: string;

  constructor(
    private readonly importer: ImporterId,
    private readonly context: ImporterContext,
  ) {
    this.existing = new Map(
      context.existingCategories.map((category) => [category.slug.toLowerCase(), category]),
    );
    this.now = context.now.toISOString();
  }

  warn(message: string): void {
    this.warnings.add(message);
  }

  skip(file: string, row: string, reason: string, values?: Readonly<Record<string, string>>): void {
    this.skippedTotal += 1;
    if (this.skipped.length < maxSkippedListed) {
      this.skipped.push(values ? { file, row, reason, values } : { file, row, reason });
    }
  }

  noteDateOrder(order: DateOrder | null): void {
    if (order === "dmy" || (order === "mdy" && this.dateOrder === null)) this.dateOrder = order;
  }

  file(detected: DetectedFile, rows: number): void {
    this.files.push({ ...detected, rows });
  }

  unknownColumns(file: string, columns: readonly string[]): void {
    if (columns.length > 0) this.unknown.push({ file, columns: columns.slice(0, 50) });
  }

  get memberCount(): number {
    return this.memberships.length;
  }

  addMember(input: MemberInput): void {
    const email = input.email?.toLowerCase() ?? "";
    if (!emailSchema.safeParse(email).success) {
      this.skip(input.file, input.row, "The email is missing or not valid.", input.values);
      return;
    }
    if (this.byEmail.has(email)) {
      this.skip(input.file, input.row, "This email appears earlier in the file.", input.values);
      return;
    }
    if (this.memberships.length >= importerMaxMembers) {
      this.skip(
        input.file,
        input.row,
        `Only the first ${importerMaxMembers} members are read.`,
        input.values,
      );
      return;
    }
    const id = this.context.newId();
    const name = cut(input.name?.trim() || email.split("@")[0] || email, nameMax);
    const joinedAt = input.joinedAt?.toISOString() ?? this.now;
    this.users.push({
      id,
      email,
      name,
      username: null,
      emailVerified: false,
      erased: false,
      createdAt: joinedAt,
    });
    this.memberships.push({
      id: this.context.newId(),
      userId: id,
      role: input.role,
      status: "active",
      bio: input.bio ? cut(input.bio, bioMax) : null,
      joinAnswers:
        input.joinAnswers.length > 0
          ? input.joinAnswers.slice(0, 3).map((answer) => cut(answer, answerMax))
          : null,
      bannedEmail: null,
      joinedAt,
      lastSeenAt: input.lastSeenAt?.toISOString() ?? null,
      createdAt: joinedAt,
    });
    if (input.points !== null) {
      const points = Math.min(Math.max(Math.trunc(input.points), 0), 1_000_000_000);
      this.stats.push({
        userId: id,
        pointsTotal: points,
        level: levelFor(points),
        updatedAt: this.now,
      });
    }
    this.byEmail.set(email, id);
    if (input.wasPaying) this.paying.push(email);
    for (const sourceId of input.sourceIds) this.bySourceId.set(sourceId, id);
    const key = nameKey(name);
    this.byName.set(key, [...(this.byName.get(key) ?? []), id]);
    this.candidates.set(id, { id, name, email });
    if (input.role !== "member") {
      this.rolesTotal += 1;
      if (this.roles.length < mappingListed) {
        this.roles.push({ name, email, role: input.role, sourceRole: input.sourceRole });
      }
    }
  }

  private uniqueByName(name: string | null | undefined): string | undefined {
    const ids = name ? this.byName.get(nameKey(name)) : undefined;
    return ids?.length === 1 ? ids[0] : undefined;
  }

  private placeholder(name: string): string {
    const id = this.context.newId();
    this.users.push({
      id,
      email: `former-${id}@import.invalid`,
      name,
      username: null,
      emailVerified: false,
      erased: true,
      createdAt: this.now,
    });
    return id;
  }

  private formerName(name: string | null | undefined): string {
    const trimmed = name?.trim();
    if (!trimmed) return formerMemberName;
    return `${cut(trimmed, nameMax - formerMemberMarker.length)}${formerMemberMarker}`;
  }

  displayName(userId: string): string {
    return (
      this.candidates.get(userId)?.name ??
      this.users.find((user) => user.id === userId)?.name ??
      formerMemberName
    );
  }

  resolveAuthor(author: AuthorRef): string {
    const email = author.email?.toLowerCase();
    const matched =
      (email ? this.byEmail.get(email) : undefined) ??
      (author.id ? this.bySourceId.get(author.id) : undefined) ??
      (author.handle ? this.bySourceId.get(author.handle) : undefined) ??
      this.uniqueByName(author.name) ??
      this.uniqueByName(author.handle);
    if (matched) return matched;
    const sameName = [author.name, author.handle].find(
      (name): name is string => !!name && (this.byName.get(nameKey(name))?.length ?? 0) > 1,
    );
    if (sameName) return this.ambiguousAuthor(sameName);
    const key =
      email ??
      (author.id ? `id:${author.id}` : null) ??
      nameKey(author.name ?? author.handle ?? "");
    const existing = this.formerMembers.get(key);
    if (existing) return existing;
    const id = this.placeholder(this.formerName(author.name ?? author.handle));
    this.formerMembers.set(key, id);
    return id;
  }

  private ambiguousAuthor(name: string): string {
    const key = nameKey(name);
    const ids = this.byName.get(key) ?? [];
    const known = this.ambiguous.get(key);
    if (known) return known.placeholderId;
    const placeholderId = this.placeholder(this.formerName(name));
    this.ambiguous.set(key, {
      name: name.trim(),
      placeholderId,
      candidates: ids.flatMap((id) => {
        const candidate = this.candidates.get(id);
        return candidate ? [candidate] : [];
      }),
    });
    return placeholderId;
  }

  category(name: string | null): string | null {
    const trimmed = name?.trim();
    if (!trimmed) return null;
    const label = cut(trimmed, categoryNameMax);
    const key = label.toLowerCase();
    if (this.categoryByName.has(key)) return this.categoryByName.get(key) ?? null;
    const slug = slugify(label);
    const current = this.existing.get(slug);
    if (!current && this.existing.size + this.newCategories >= maxCategories) {
      this.categoryByName.set(key, null);
      this.mapCategory({ source: label, target: null, existing: false });
      this.warn(
        `A community has up to ${maxCategories} categories. Posts in the others have no category.`,
      );
      return null;
    }
    const id = this.context.newId();
    if (current) {
      this.categories.push({
        id,
        name: current.name,
        slug: current.slug,
        color: current.color,
        position: current.position,
        staffOnly: current.staffOnly,
        createdAt: this.now,
      });
    } else {
      this.newCategories += 1;
      this.categories.push({
        id,
        name: label,
        slug,
        color: "neutral",
        position: this.existing.size + this.newCategories - 1,
        staffOnly: false,
        createdAt: this.now,
      });
    }
    this.categoryByName.set(key, id);
    this.mapCategory({ source: label, target: current?.name ?? label, existing: !!current });
    return id;
  }

  private mapCategory(entry: CategoryMapping): void {
    if (this.categoryMapping.length < mappingListed) this.categoryMapping.push(entry);
  }

  private track(body: ConvertedText): void {
    this.droppedImages += body.droppedImages;
    if (body.truncated) this.truncated += 1;
  }

  addPost(input: PostInput): void {
    if (this.posts.length >= importerMaxPosts) {
      this.skip(input.file, input.row, `Only the first ${importerMaxPosts} posts are read.`);
      return;
    }
    this.track(input.body);
    const title = input.title ? cut(input.title, titleMax) : null;
    let body = input.body.doc;
    if (body.content.length === 0) {
      if (!title) {
        this.skip(input.file, input.row, "The post has no text that can be imported.");
        return;
      }
      this.titleOnly += 1;
      body = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: title }] }],
      };
    }
    const id = this.context.newId();
    const createdAt = input.createdAt?.toISOString() ?? this.now;
    const updatedAt = input.updatedAt?.toISOString() ?? createdAt;
    const authorId = this.resolveAuthor(input.author);
    const categoryId = this.category(input.category);
    this.sample ??= {
      title,
      author: this.displayName(authorId),
      category: this.categories.find((row) => row.id === categoryId)?.name ?? null,
      excerpt: extractExcerpt(body, sampleExcerptLength),
    };
    this.posts.push({
      id,
      authorId,
      categoryId,
      title,
      body,
      pinnedAt: null,
      editedAt: null,
      deletedAt: null,
      deletedBy: null,
      lastActivityAt: createdAt,
      createdAt,
      updatedAt: updatedAt < createdAt ? createdAt : updatedAt,
    });
    if (input.pinned) this.pinned.push({ id, createdAt });
    for (const key of input.sourceKeys) this.postByKey.set(key, id);
  }

  addComment(input: CommentInput): void {
    if (this.comments.length >= importerMaxComments) {
      this.skip(input.file, input.row, `Only the first ${importerMaxComments} comments are read.`);
      return;
    }
    this.track(input.body);
    if (input.body.doc.content.length === 0) {
      this.skip(input.file, input.row, "The comment has no text that can be imported.");
      return;
    }
    this.comments.push({
      ...input,
      id: this.context.newId(),
      authorId: this.resolveAuthor(input.author),
    });
  }

  private finishComments(): ArchiveRecord<"comments">[] {
    const byKey = new Map<string, PendingComment>();
    for (const comment of this.comments) {
      if (comment.sourceKey) byKey.set(comment.sourceKey, comment);
    }
    const topOf = (comment: PendingComment): PendingComment | null => {
      let current = comment;
      const seen = new Set<string>();
      while (current.parentKey) {
        if (seen.has(current.id)) return null;
        seen.add(current.id);
        const parent = byKey.get(current.parentKey);
        if (!parent) return null;
        current = parent;
      }
      return current;
    };
    const lastActivity = new Map<string, string>();
    const result: ArchiveRecord<"comments">[] = [];
    for (const comment of this.comments) {
      const top = comment.parentKey ? topOf(comment) : comment;
      if (!top) {
        this.skip(comment.file, comment.row, "The comment it replies to is not in the files.");
        continue;
      }
      const postId = top.postKey ? this.postByKey.get(top.postKey) : undefined;
      if (!postId) {
        this.skip(comment.file, comment.row, "The post it belongs to is not in the files.");
        continue;
      }
      const createdAt = comment.createdAt?.toISOString() ?? this.now;
      const updatedAt = comment.updatedAt?.toISOString() ?? createdAt;
      result.push({
        id: comment.id,
        postId,
        parentId: top === comment ? null : top.id,
        authorId: comment.authorId,
        body: comment.body.doc,
        editedAt: null,
        deletedAt: null,
        deletedBy: null,
        createdAt,
        updatedAt: updatedAt < createdAt ? createdAt : updatedAt,
      });
      const previous = lastActivity.get(postId);
      if (!previous || previous < createdAt) lastActivity.set(postId, createdAt);
    }
    const kept = new Set(result.map((row) => row.id));
    const orphaned = result.filter((row) => row.parentId !== null && !kept.has(row.parentId));
    for (const row of orphaned) Object.assign(row, { parentId: null });
    for (let index = 0; index < this.posts.length; index += 1) {
      const post = this.posts[index];
      const latest = post ? lastActivity.get(post.id) : undefined;
      if (post && latest && latest > post.lastActivityAt) {
        this.posts[index] = { ...post, lastActivityAt: latest };
      }
    }
    return result;
  }

  private finishPins(): void {
    const newest = [...this.pinned]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, maxPinnedPosts);
    if (this.pinned.length > maxPinnedPosts) {
      this.warn(`A community pins up to ${maxPinnedPosts} posts. The newest ones stay pinned.`);
    }
    const ids = new Map(newest.map((pin) => [pin.id, pin.createdAt]));
    for (let index = 0; index < this.posts.length; index += 1) {
      const post = this.posts[index];
      const pinnedAt = post ? ids.get(post.id) : undefined;
      if (post && pinnedAt) this.posts[index] = { ...post, pinnedAt };
    }
  }

  build(): { records: ArchiveRecords; report: ImportReport } {
    const comments = this.finishComments();
    this.finishPins();
    if (this.memberships.length === 0) {
      this.warn("No members were found. Add the members CSV so posts keep their authors.");
    }
    if (this.droppedImages > 0) {
      this.warn(
        this.droppedImages === 1
          ? "1 image inside a post or comment is not copied."
          : `${this.droppedImages} images inside posts and comments are not copied.`,
      );
    }
    if (this.truncated > 0) {
      this.warn(
        this.truncated === 1
          ? "1 post or comment was too long and was cut."
          : `${this.truncated} posts or comments were too long and were cut.`,
      );
    }
    if (this.titleOnly > 0) {
      this.warn(
        this.titleOnly === 1
          ? "1 post had no text besides the title. The title is the body."
          : `${this.titleOnly} posts had no text besides the title. The title is the body.`,
      );
    }
    if (this.paying.length > 0) {
      this.warn(
        `${this.paying.length === 1 ? "1 member was" : `${this.paying.length} members were`} paying. After the import, give them free time to subscribe again on Bring your existing subscribers.`,
      );
    }
    if (this.ambiguous.size > 0) {
      this.warn(
        this.ambiguous.size === 1
          ? "1 author name matches more than one member. Choose who wrote their posts below."
          : `${this.ambiguous.size} author names match more than one member. Choose who wrote their posts below.`,
      );
    }
    if (this.formerMembers.size > 0) {
      this.warn(
        this.formerMembers.size === 1
          ? "1 author is not in the members file. Their posts and comments keep their name, marked as former member."
          : `${this.formerMembers.size} authors are not in the members file. Their posts and comments keep their name, marked as former member.`,
      );
    }
    const { community } = this.context;
    const records: ArchiveRecords = {
      community: [
        {
          id: community.id,
          slug: community.slug,
          name: community.name,
          description: null,
          privacy: "private",
          joinMode: "open",
          joinQuestions: null,
          appearance: {},
          gamificationEnabled: true,
          levelNames: levelThresholds.map((_, index) => `Level ${index + 1}`),
          detailedDescription: null,
          archivedAt: null,
          createdAt: this.now,
        },
      ],
      users: this.users,
      memberships: this.memberships,
      categories: this.categories,
      posts: this.posts,
      post_images: [],
      comments,
      reactions: [],
      courses: [],
      course_modules: [],
      lessons: [],
      lesson_progress: [],
      lesson_agent_layers: [],
      course_agent_versions: [],
      course_agent_settings: [],
      events: [],
      event_occurrences: [],
      event_rsvps: [],
      points_ledger: [],
      member_stats: this.stats,
      membership_plans: [],
      subscriptions: [],
      comped_memberships: [],
      invite_links: [],
      community_gallery: [],
      membership_requests: [],
      reviews: [],
      review_replies: [],
      audit_log: [],
    };
    const report: ImportReport = {
      importer: { id: this.importer, version: importerCatalog[this.importer].version },
      files: this.files,
      warnings: [...this.warnings],
      skipped: this.skipped,
      skippedTotal: this.skippedTotal,
      unknownColumns: this.unknown,
      formerMemberAuthors: this.formerMembers.size,
      ambiguousAuthors: [...this.ambiguous.values()].slice(0, maxAmbiguousListed),
      dateOrder: this.dateOrder,
      suggestedImporter: null,
      mapping: {
        roles: this.roles,
        rolesTotal: this.rolesTotal,
        categories: this.categoryMapping,
        sample: this.sample,
      },
      paying: this.paying,
    };
    return { records, report };
  }
}

export function pointsAtLevel(level: number): number {
  const index = Math.min(Math.max(Math.trunc(level), 1), levelThresholds.length) - 1;
  return levelThresholds[index] ?? 0;
}
