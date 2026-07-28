import { patchPodfileForXcode27 } from '../../plugins/withXcode27DeploymentTargets';

const podfile = `platform :ios, podfile_properties['ios.deploymentTarget'] || '16.4'

target 'UniClipDev' do
  post_install do |installer|
    react_native_post_install(installer)
  end
end
`;

describe('Xcode 27 iOS deployment targets', () => {
  it('raises only pod targets below the configured application target', () => {
    const patched = patchPodfileForXcode27(podfile);

    expect(patched).toContain("podfile_properties['ios.deploymentTarget'] || '16.4'");
    expect(patched).toContain(
      'Gem::Version.new(current_deployment_target) < minimum_deployment_target'
    );
    expect(patched).toContain(
      "build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = minimum_deployment_target.to_s"
    );
  });

  it('is stable when Expo generates the same project again', () => {
    const once = patchPodfileForXcode27(podfile);
    const twice = patchPodfileForXcode27(once);

    expect(twice).toBe(once);
    expect(twice.match(/@generated begin uniclip-xcode-27-deployment-targets/g)).toHaveLength(1);
  });
});
