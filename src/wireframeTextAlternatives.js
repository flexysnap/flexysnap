// Texts without alternate_id are not alternatives of anything, so only texts that share a non-undefined alternate_id form a group.
function findAlternativeIndices(texts, index) {
    const alternateId = texts[index].alternate_id;
    if (alternateId === undefined) {
        return [index];
    }

    const indices = [];
    texts.forEach((text, i) => {
        if (text.alternate_id === alternateId) {
            indices.push(i);
        }
    });
    return indices;
}

export { findAlternativeIndices };