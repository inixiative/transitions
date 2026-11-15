# transitions glossary

**Every term transitions's region Wardens use, alphabetical, each with the region that holds it.**

<!-- Generated with the region Warden docs by the region pipeline's assemble.py. A term defined by two regions appears once per region. -->

---

## 4

**403 vs 409**  
Caller's mapping: a path failing purely on permission is 403; any predicate failure is 409. *Region:* [Lifecycle guards and affordances](lifecycle-guards/knowledge.md)

## A

**absent = open**  
A side with no permission allows anyone; use deliberately. *Region:* [Transition authorization](transition-authorization/knowledge.md)

**Action**  
A named verb such as approve: { paths: Transition[], label? }, the OR of its edges. *Region:* [Lifecycle guards and affordances](lifecycle-guards/knowledge.md)

**ActionRule**  
permissions' serializable permission algebra, re-exported: string, { rel, action }, { rule }, any/all, true/false, null. *Region:* [Transition authorization](transition-authorization/knowledge.md)

**__actor**  
Name under which an abac { rule } reads the acting user. *Region:* [Transition authorization](transition-authorization/knowledge.md)

**actor**  
permissions' { model, record }, passed beside authorize in the check options. *Region:* [Transition authorization](transition-authorization/knowledge.md)

**affordance**  
Class: listing what can happen, available for one record and eligible as a Prisma plan for every record. *Region:* [Lifecycle guards and affordances](lifecycle-guards/knowledge.md)

**affordance hint**  
What available returns: actions to offer in UI or API; the to side defers to checkTransition. *Region:* [Lifecycle guards and affordances](lifecycle-guards/knowledge.md)

**append**  
{ kind: 'append', path }: concat onto the array at a field path (≈ $push). *Region:* [Tenant-stored transitions and merge](tenant-stored-transitions/knowledge.md)

**appendUnique**  
{ kind: 'appendUnique', path }: concat and dedupe at a field path (≈ $addToSet). *Region:* [Tenant-stored transitions and merge](tenant-stored-transitions/knowledge.md)

**applyMerge**  
applyMerge(merge, record, changes) -> next record; what checkPath uses internally. *Region:* [Tenant-stored transitions and merge](tenant-stored-transitions/knowledge.md)

**authoring-validation**  
Class: validateTransition, the save-time check for tenant-authored transitions. *Region:* [Tenant-stored transitions and merge](tenant-stored-transitions/knowledge.md)

**Authorize**  
Injected evaluator callback; the kernel hands it each side's permission with the record and actor. *Region:* [Transition authorization](transition-authorization/knowledge.md)

**authorize-seam**  
Class: the injected Authorize callback and createAuthorize, the adapter over @inixiative/permissions. *Region:* [Transition authorization](transition-authorization/knowledge.md)

**available**  
available(rules, resource, record, { actor, authorize }) -> action names whose from side passes; a hint, not authoritative. *Region:* [Lifecycle guards and affordances](lifecycle-guards/knowledge.md)

## B

**bindings**  
Caller-supplied values a predicate reads through { bind: name }; eligible resolves them into the compiled where. *Region:* [Lifecycle guards and affordances](lifecycle-guards/knowledge.md)

## C

**check options**  
json-rules check() options now, timeZone, weekStart, bindings, passed beside actor / authorize to checks and eligible. *Region:* [Lifecycle guards and affordances](lifecycle-guards/knowledge.md)

**check-transition**  
Class: guarding one proposed change with checkTransition / checkPath and reporting a structured Reason. *Region:* [Lifecycle guards and affordances](lifecycle-guards/knowledge.md)

**checkPath**  
Single-edge kernel: checkPath(transition, record, changes, options) -> true | PathReason. *Region:* [Lifecycle guards and affordances](lifecycle-guards/knowledge.md)

**checkTransition**  
checkTransition(rules, resource, action, record, changes, options) -> true | Reason; authoritative, first passing path wins. *Region:* [Lifecycle guards and affordances](lifecycle-guards/knowledge.md)

**createAuthorize**  
createAuthorize({ schema, map, isSuperadmin?, data? })(resource) returns an Authorize bound to one map-qualified resource. *Region:* [Transition authorization](transition-authorization/knowledge.md)

**createRebacCheck**  
@inixiative/permissions' production rebac check that createAuthorize wraps; not reimplemented here. *Region:* [Transition authorization](transition-authorization/knowledge.md)

## D

**data**  
Optional createAuthorize input supplying hydrated rows for cross-map bridge walks. *Region:* [Transition authorization](transition-authorization/knowledge.md)

**deepMerge**  
Recursive merge, arrays replaced (≈ $merge). *Region:* [Tenant-stored transitions and merge](tenant-stored-transitions/knowledge.md)

**describe**  
describe(reason) turns a Reason into a human-readable message. *Region:* [Lifecycle guards and affordances](lifecycle-guards/knowledge.md)

## E

**effective authz**  
from.permission AND to.permission, each against the record it reads. *Region:* [Transition authorization](transition-authorization/knowledge.md)

**eligible**  
eligible(rules, resource, action, options) -> json-rules Prisma plan (ToPrismaResult) for every record the action is open to. *Region:* [Lifecycle guards and affordances](lifecycle-guards/knowledge.md)

**executePrismaPlan**  
json-rules' executePrismaPlan(plan, prisma): resolves an eligible plan's references and returns the Prisma where. *Region:* [Lifecycle guards and affordances](lifecycle-guards/knowledge.md)

## F

**fail closed**  
createAuthorize catches permissions' cycle error and denies so the guard terminates. *Region:* [Transition authorization](transition-authorization/knowledge.md)

**field/relation allowlist**  
Scoping which fields a tenant may reference, since its predicate compiles to a real Prisma where. *Region:* [Tenant-stored transitions and merge](tenant-stored-transitions/knowledge.md)

**from / to**  
from.* reads the current record; to.* reads the merged record; applies to predicate and permission. *Region:* [Lifecycle guards and affordances](lifecycle-guards/knowledge.md)

**from.permission**  
Authz against the current record; where verb-capability and 'who may leave this state' rules go. *Region:* [Transition authorization](transition-authorization/knowledge.md)

## I

**isSerializable**  
isSerializable(transition): can it be stored in the DB, edited in a UI or sent over the wire. *Region:* [Tenant-stored transitions and merge](tenant-stored-transitions/knowledge.md)

**isSerializableMerge**  
isSerializableMerge(merge): true when absent or a keyword, false for a callback. *Region:* [Tenant-stored transitions and merge](tenant-stored-transitions/knowledge.md)

**isSuperadmin**  
Optional createAuthorize callback deriving a superadmin bypass from the actor. *Region:* [Transition authorization](transition-authorization/knowledge.md)

## L

**legality only**  
Omitting authorize: only predicates are checked, permissions are skipped. *Region:* [Transition authorization](transition-authorization/knowledge.md)

**lens**  
json-rules field scope: which fields and relations a tenant predicate may reference; not authorization. *Region:* [Tenant-stored transitions and merge](tenant-stored-transitions/knowledge.md)

## M

**map / mapName / model / lens**  
toPrisma schema options eligible needs to compile column comparisons or relation counts. *Region:* [Lifecycle guards and affordances](lifecycle-guards/knowledge.md)

**merge callback**  
(record, changes) => next: full power for code callers, not serializable. *Region:* [Tenant-stored transitions and merge](tenant-stored-transitions/knowledge.md)

**merge-strategies**  
Class: how to.merge builds the merged record (spread, deepMerge, append, appendUnique, callback) and applyMerge. *Region:* [Tenant-stored transitions and merge](tenant-stored-transitions/knowledge.md)

**merged record**  
The resulting record that to.predicate and to.permission are evaluated against. *Region:* [Tenant-stored transitions and merge](tenant-stored-transitions/knowledge.md)

**MergeStrategy**  
Serializable keyword merge: 'spread' | 'deepMerge' | { kind: 'append' | 'appendUnique', path }. *Region:* [Tenant-stored transitions and merge](tenant-stored-transitions/knowledge.md)

## N

**no-op guard**  
Whether something must change is expressed in the from/to predicates, not by the library. *Region:* [Lifecycle guards and affordances](lifecycle-guards/knowledge.md)

## P

**PathReason**  
{ from?: SideReason, to?: SideReason }: why one candidate path failed. *Region:* [Lifecycle guards and affordances](lifecycle-guards/knowledge.md)

**permission-placement**  
Class: the decided rule that permission lives only on a from/to side, never on the action or edge. *Region:* [Transition authorization](transition-authorization/knowledge.md)

**predicate**  
A json-rules Condition on a side: is this state shape legal? *Region:* [Lifecycle guards and affordances](lifecycle-guards/knowledge.md)

## R

**Reason**  
{ paths: PathReason[] }: one entry per path tried, returned instead of a bare false. *Region:* [Lifecycle guards and affordances](lifecycle-guards/knowledge.md)

**RebacSchema**  
permissions' { bridges?, permissions } schema, passed to createAuthorize as schema. *Region:* [Transition authorization](transition-authorization/knowledge.md)

**{ rel, action }**  
ActionRule that walks a relation through the schema map and checks an action there (e.g. { rel: 'sourceUser', action: 'cancel' }). *Region:* [Transition authorization](transition-authorization/knowledge.md)

**requires**  
Prisma-include-shaped metadata naming relations a predicate reads; the kernel ignores it and no loader is built. *Region:* [Lifecycle guards and affordances](lifecycle-guards/knowledge.md)

**requires**  
Include-shaped relation metadata, JSON and so storable; validateTransition checks its shape. *Region:* [Tenant-stored transitions and merge](tenant-stored-transitions/knowledge.md)

**requireSerializable**  
validateTransition option: report a callback merge as unserializable_merge. *Region:* [Tenant-stored transitions and merge](tenant-stored-transitions/knowledge.md)

**resource**  
Map-qualified key (map:Model, e.g. db:Inquiry) under which a lifecycle's actions are declared, as in @inixiative/permissions. *Region:* [Lifecycle guards and affordances](lifecycle-guards/knowledge.md)

**{ rule }**  
abac ActionRule: a json-rules Condition over record fields, the actor read as __actor. *Region:* [Transition authorization](transition-authorization/knowledge.md)

## S

**SchemaMap**  
permissions' { resources, fieldMap, polymorphism? }: which model each resource is and its relations; createAuthorize's map. *Region:* [Transition authorization](transition-authorization/knowledge.md)

**scope-non-goals**  
Class: what the package is not (state machine, workflow engine, side effects, config UI) and what is not built yet. *Region:* [Lifecycle guards and affordances](lifecycle-guards/knowledge.md)

**Side**  
{ predicate, permission?, requires? }: one half of a transition, evaluated against one record. *Region:* [Lifecycle guards and affordances](lifecycle-guards/knowledge.md)

**SideReason**  
{ predicate?: string, permission?: string }: legality and authz failures of one side, reported independently. *Region:* [Lifecycle guards and affordances](lifecycle-guards/knowledge.md)

**spread**  
Default merge: shallow overwrite (≈ $set). *Region:* [Tenant-stored transitions and merge](tenant-stored-transitions/knowledge.md)

**string delegation**  
An ActionRule naming a permission action (e.g. 'resolve') resolved through the rebac schema, with cycle detection. *Region:* [Transition authorization](transition-authorization/knowledge.md)

## T

**tenant-config**  
Class: transitions as pure data stored per tenant; isSerializable / isSerializableMerge decide storability. *Region:* [Tenant-stored transitions and merge](tenant-stored-transitions/knowledge.md)

**terminal deny**  
permission null or false: the side always denies. *Region:* [Transition authorization](transition-authorization/knowledge.md)

**to.merge**  
Merge on the to side that turns record + changes into the resulting record; default spread. *Region:* [Tenant-stored transitions and merge](tenant-stored-transitions/knowledge.md)

**to.permission**  
Authz against the merged record; checked only by checkTransition / checkPath, not available. *Region:* [Transition authorization](transition-authorization/knowledge.md)

**toPrisma**  
json-rules compiler that eligible uses to turn from-predicates into a Prisma plan. *Region:* [Lifecycle guards and affordances](lifecycle-guards/knowledge.md)

**Transition**  
One atomic from -> to edge; never holds an OR or a permission of its own. *Region:* [Lifecycle guards and affordances](lifecycle-guards/knowledge.md)

**transition action vs permission action**  
A state verb (approve) is distinct from a rebac capability (read), though a side's permission may name one. *Region:* [Transition authorization](transition-authorization/knowledge.md)

**transition-model**  
Class: the data shape resource -> action -> Action { paths, label? } -> Transition { from, to & { merge? } } -> Side. *Region:* [Lifecycle guards and affordances](lifecycle-guards/knowledge.md)

## V

**validateActionRule**  
@inixiative/permissions validator for a side's permission shape (every { rule } positive). *Region:* [Tenant-stored transitions and merge](tenant-stored-transitions/knowledge.md)

**validateRule**  
json-rules rule validator validateTransition runs on each predicate. *Region:* [Tenant-stored transitions and merge](tenant-stored-transitions/knowledge.md)

**validateRuleInLens**  
json-rules lens-scoped validator validateTransition runs when given a lens. *Region:* [Tenant-stored transitions and merge](tenant-stored-transitions/knowledge.md)

**validateTransition**  
validateTransition(t, { lens?, requireSerializable? }) -> ValidationResult; never throws. *Region:* [Tenant-stored transitions and merge](tenant-stored-transitions/knowledge.md)

**validation codes**  
Codes transitions adds: missing_side, missing_predicate, invalid_permission, invalid_requires, invalid_merge, unserializable_merge. *Region:* [Tenant-stored transitions and merge](tenant-stored-transitions/knowledge.md)

**ValidationResult**  
json-rules' { ok, errors: { path, message, code }[] }. *Region:* [Tenant-stored transitions and merge](tenant-stored-transitions/knowledge.md)
