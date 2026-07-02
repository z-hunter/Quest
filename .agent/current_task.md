# Current Task: Entity Collider Proportional Scaling

## Status: COMPLETED ✅

## Summary of the implementation
- **Proportional Scaling:** Modified the `Entity` class to support getters/setters for `colliderWidth` and `colliderHeight`. They now scale at runtime by multiplying/dividing by `this.scale`.
- **Loading Safeguard:** Setters for `width`, `height`, `colliderWidth`, and `colliderHeight` are bypassed during the loading process (`this.isLoading === true`) to prevent order-dependent corruption.
- **Serialization Bypass:** Excluded `colliderWidth` and `colliderHeight` from `SERIALIZABLE_PROPS` to prevent feedback scaling loops.
- **Manual Serialization & Deserialization:** Updated `toJSON()` and `load()` to manually serialize and deserialize unscaled backing fields (`_baseColliderWidth` and `_baseColliderHeight`) under the standard keys (`colliderWidth` and `colliderHeight`). This preserves full compatibility with the existing JSON schema.
- **Tests & Typecheck:** Added an integration/unit test in `tests/game/navigation-and-spatial.test.ts` verifying proportional scaling, serialization, and deserialization. TypeScript checks and the full test suite run successfully (with only the pre-existing PM tests failing).
