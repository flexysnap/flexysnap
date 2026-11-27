const MIN_BOUNDING_RECT_AREA = 10;

function boundingRectArea(boundingRect) {
    return (boundingRect.right - boundingRect.left) * (boundingRect.bottom - boundingRect.top);
}

function hasSmallBoundingRect(boundingRect) {
    return boundingRectArea(boundingRect) < MIN_BOUNDING_RECT_AREA;
}

function withoutSmallBoundingRects(elementGroup) {
    return {
        ...elementGroup,
        elements: elementGroup.elements
            .filter(element => !hasSmallBoundingRect(element.boundingRect))
            .map(element => ({
                ...element,
                texts: (element.texts || []).filter(text => !hasSmallBoundingRect(text.boundingRect))
            }))
    };
}

export { withoutSmallBoundingRects, MIN_BOUNDING_RECT_AREA };