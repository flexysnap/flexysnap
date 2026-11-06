import path from 'path';

let folders = null;

function setWireframeFolders(newFolders) {
    if (!newFolders.currentFolder || typeof newFolders.currentFolder !== 'string' ||
        !newFolders.baselineFolder || typeof newFolders.baselineFolder !== 'string') {
        throw new Error('setWireframeFolders requires non-empty currentFolder and baselineFolder strings.');
    }

    folders = {
        currentFolder: path.resolve(newFolders.currentFolder),
        baselineFolder: path.resolve(newFolders.baselineFolder)
    };
}

function getWireframeFolders() {
    if (folders === null) {
        throw new Error('Wireframe folders are not set. Call setWireframeFolders first.');
    }

    return folders;
}

function chooseWireframeFolder(wireframeFolders, baselineFileExists) {
    return baselineFileExists ? wireframeFolders.currentFolder : wireframeFolders.baselineFolder;
}

export {
    setWireframeFolders,
    getWireframeFolders,
    chooseWireframeFolder
};