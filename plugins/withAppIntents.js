// Adds MyOrbit's Siri / Shortcuts intents (plugins/app-intents/*.swift) to the
// main iOS app target on `expo prebuild`, so they survive regenerating ios/.
const { IOSConfig, withDangerousMod, withXcodeProject } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const FILES = ['MyOrbitIntents.swift'];

function withAppIntents(config) {
  // 1. Copy the sources next to the app's own files.
  config = withDangerousMod(config, [
    'ios',
    (cfg) => {
      const projectName = IOSConfig.XcodeUtils.getProjectName(cfg.modRequest.projectRoot);
      const dest = path.join(cfg.modRequest.platformProjectRoot, projectName);
      for (const file of FILES) {
        fs.copyFileSync(path.join(cfg.modRequest.projectRoot, 'plugins', 'app-intents', file), path.join(dest, file));
      }
      return cfg;
    },
  ]);

  // 2. Compile them into the app target (not the widget extension).
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const projectName = IOSConfig.XcodeUtils.getProjectName(cfg.modRequest.projectRoot);
    const [targetUuid] = IOSConfig.Target.findNativeTargetByName(project, projectName);
    for (const file of FILES) {
      const filepath = `${projectName}/${file}`;
      if (!project.hasFile(filepath)) {
        IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath, groupName: projectName, project, targetUuid });
      }
    }
    return cfg;
  });
}

module.exports = withAppIntents;
