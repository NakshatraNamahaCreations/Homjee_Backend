
const n = (v) => Number(v);

export const validateCatalogUpdate = (
    oldData,
    newData,
    options = { lockTeamMembers: true, lockDuration: true }
) => {
    const errors = [];

    if (!oldData || typeof oldData !== "object") {
        errors.push("Old config missing or invalid.");
        return errors;
    }
    if (!newData || typeof newData !== "object") {
        errors.push("New config missing or invalid.");
        return errors;
    }

    const oldKeys = Object.keys(oldData);
    const newKeys = Object.keys(newData);

    // 1) category keys must match exactly
    const missingKeys = oldKeys.filter((k) => !newKeys.includes(k));
    const extraKeys = newKeys.filter((k) => !oldKeys.includes(k));
    if (missingKeys.length)
        errors.push(`Category keys missing: ${missingKeys.join(", ")}`);
    if (extraKeys.length)
        errors.push(`Category keys not allowed: ${extraKeys.join(", ")}`);

    // Stop early if category mismatch (prevents runtime issues below)
    if (missingKeys.length || extraKeys.length) return errors;

    // 2) package name lock + optional field locks
    for (const categoryKey of oldKeys) {
        const oldArr = Array.isArray(oldData[categoryKey]) ? oldData[categoryKey] : [];
        const newArr = Array.isArray(newData[categoryKey]) ? newData[categoryKey] : [];

        if (oldArr.length !== newArr.length) {
            errors.push(`Package count changed in "${categoryKey}" (not allowed).`);
            continue;
        }

        for (let i = 0; i < oldArr.length; i++) {
            const oldPkg = oldArr[i] || {};
            const newPkg = newArr[i] || {};

            // name is identity (locked)
            if ((oldPkg.name || "") !== (newPkg.name || "")) {
                errors.push(
                    `Package name changed in "${categoryKey}" at index ${i}: ` +
                    `"${oldPkg.name}" -> "${newPkg.name}" (not allowed)`
                );
            }

            // optional locks
            if (options.lockTeamMembers) {
                if (n(oldPkg.teamMembers) !== n(newPkg.teamMembers)) {
                    errors.push(
                        `teamMembers changed for "${oldPkg.name}" in "${categoryKey}" (not allowed)`
                    );
                }
            }

            if (options.lockDuration) {
                if (n(oldPkg.duration) !== n(newPkg.duration)) {
                    errors.push(
                        `duration changed for "${oldPkg.name}" in "${categoryKey}" (not allowed)`
                    );
                }
            }
        }
    }

    return errors;
};
