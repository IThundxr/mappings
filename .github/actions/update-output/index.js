const fs = require("fs");
const core = require("@actions/core");
const github = require("@actions/github");
const { PropertiesEditor } = require("properties-file/editor");
const { getProperties } = require("properties-file");

(async () => {
    try {
        const octokit = github.getOctokit(core.getInput("GITHUB_TOKEN"));
        
        const contents = fs.readFileSync('gradle.properties').toString();
        const immutableProperties = getProperties(contents)
        const properties = new PropertiesEditor(contents)
        
        const res = await fetch("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json", {})
        if (!res.ok) {
            core.setFailed(`Failed to fetch data from piston meta: ${res.status} ${res.statusText}`);
            return;
        }
        
        const versionManifest = await res.json();

        let hasUpdated = false;

        const cLatestRelease = immutableProperties.latest_release;
        const cLatestSnapshot = immutableProperties.latest_snapshot;
        
        const mLatestRelease = versionManifest.latest.release.toString();
        const mLatestSnapshot = versionManifest.latest.snapshot.toString();

        console.log("---------------------------------------------------------");
        console.log("Current release version: " + cLatestRelease);
        console.log("Current snapshot version: " + cLatestSnapshot);
        console.log("---------------------------------------------------------");
        console.log("Latest release version: " + mLatestRelease);
        console.log("Latest snapshot version: " + mLatestSnapshot);
        console.log("---------------------------------------------------------");
        
        if (mLatestRelease !== cLatestRelease) {
            hasUpdated = true;
            properties.update("latest_release", {
                newValue: mLatestRelease,
            })
        }
        
        if (mLatestSnapshot !== cLatestSnapshot) {
            hasUpdated = true;
            properties.update("latest_snapshot", {
                newValue: mLatestSnapshot,
            })
        }
        
        if (hasUpdated) {
            if (!(await yarnAndIntermediaryExists(octokit, mLatestRelease)
                && await yarnAndIntermediaryExists(octokit, mLatestSnapshot)))
                return;
            
            const owner = github.context.repo.owner;
            const repo = github.context.repo.repo;
            
            const getFile = await octokit.rest.repos.getContent({
                owner,
                repo,
                path: "gradle.properties",
            });
            
            await octokit.rest.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: "gradle.properties",
                message: "Update Mapping Versions",
                content: btoa(properties.format()),
                sha: getFile.data.sha
            });

            await octokit.rest.actions.createWorkflowDispatch({
                owner,
                repo,
                workflow_id: "build.yml",
                ref: "main"
            });
        }
        
    } catch (error) {
        core.setFailed(error.message);
    }
})();

async function yarnAndIntermediaryExists(octokit, version) {
    const intermediaryExists = await (async () => {
        try {
            const file = await octokit.rest.repos.getContent({
                owner: "FabricMC",
                repo: "intermediary",
                path: `mappings/${version}.tiny`,
                ref: "master",
            });
            return file.data.git_url != null
        } catch (err) {
            console.log("Failed to fetch intermediary file");
            console.log(err)
            return false;
        }
    })();

    const yarnExists = await (async () => {
        const res = await fetch(`https://meta.fabricmc.net/v2/versions/yarn/${version}`);
        if (!res.ok) return false;
        const data = await res.json();
        return Array.isArray(data) && data.length > 0;
    })();

    return intermediaryExists && yarnExists;
}
