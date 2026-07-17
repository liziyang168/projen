import { secretToString } from "../../github/private/util";
import type { JobStep } from "../../github/workflows-model";
import type { NodePackage } from "../node-package";
import { CodeArtifactAuthProvider, NodePackageManager } from "../node-package";
import type { RenderWorkflowSetupOptions } from "../node-project";
import {
  executeCommandPriorInstallation,
  isYarnBerry,
  isYarnClassic,
} from "../util";

interface RenderWorkflowSetupOptionsInternal extends RenderWorkflowSetupOptions {
  readonly package: NodePackage;
  readonly nodeVersion: string | undefined;
  readonly workflowPackageCache: boolean;
  readonly workflowBootstrapSteps: JobStep[] | undefined;
}

export function renderWorkflowSetupInternal(
  options: RenderWorkflowSetupOptionsInternal,
): JobStep[] {
  const install = new Array<JobStep>();

  // first run the workflow bootstrap steps
  install.push(...(options.workflowBootstrapSteps ?? []));

  if (isYarnBerry(options.package.packageManager)) {
    install.push({
      name: "Enable corepack",
      run: "corepack enable",
    });
  } else if (options.package.packageManager === NodePackageManager.PNPM) {
    install.push({
      name: "Setup pnpm",
      uses: "pnpm/action-setup@v5",
      with: { version: options.package.pnpmVersion },
    });
  } else if (options.package.packageManager === NodePackageManager.BUN) {
    install.push({
      name: "Setup bun",
      uses: "oven-sh/setup-bun@v2",
      with: { "bun-version": options.package.bunVersion },
    });
  }

  if (options.package.packageManager !== NodePackageManager.BUN) {
    if (options.nodeVersion || options.workflowPackageCache) {
      const pm: NodePackageManager = options.package.packageManager;
      const cache =
        isYarnClassic(pm) || isYarnBerry(pm)
          ? "yarn"
          : pm === NodePackageManager.PNPM
            ? "pnpm"
            : "npm";
      install.push({
        name: "Setup Node.js",
        uses: "actions/setup-node@v6",
        with: {
          ...(options.nodeVersion && {
            "node-version": options.nodeVersion,
          }),
          ...(options.workflowPackageCache && {
            cache,
          }),
          "package-manager-cache": options.workflowPackageCache,
        },
      });
    }
  }

  const mutable = options.mutable ?? false;

  if (options.package.scopedPackagesOptions) {
    install.push(...getScopedPackageSteps(options.package));
  }

  install.push({
    name: "Install dependencies",
    run: mutable
      ? options.package.installAndUpdateLockfileCommand
      : options.package.installCommand,
    ...(options.installStepConfiguration ?? {}),
  });

  return install;
}

/**
 * Get steps for scoped package access
 *
 * @param codeArtifactOptions Details of logging in to AWS
 * @returns array of job steps required for each private scoped packages
 */
function getScopedPackageSteps(pkg: NodePackage): JobStep[] {
  const codeArtifactOptions = pkg.codeArtifactOptions;

  const parsedCodeArtifactOptions = {
    accessKeyIdSecret:
      codeArtifactOptions?.accessKeyIdSecret ?? "AWS_ACCESS_KEY_ID",
    secretAccessKeySecret:
      codeArtifactOptions?.secretAccessKeySecret ?? "AWS_SECRET_ACCESS_KEY",
    roleToAssume: codeArtifactOptions?.roleToAssume,
    authProvider: codeArtifactOptions?.authProvider,
  };

  const executeProjenCommand = `${executeCommandPriorInstallation(pkg.packageManager).join(" ")} projen`;

  if (
    parsedCodeArtifactOptions.authProvider ===
    CodeArtifactAuthProvider.GITHUB_OIDC
  ) {
    return [
      {
        name: "Configure AWS Credentials",
        uses: "aws-actions/configure-aws-credentials@v6",
        with: {
          "aws-region": "us-east-2",
          "role-to-assume": parsedCodeArtifactOptions.roleToAssume,
          "role-duration-seconds": 900,
        },
      },
      {
        name: "AWS CodeArtifact Login",
        run: `${executeProjenCommand} ca:login`,
      },
    ];
  }

  if (parsedCodeArtifactOptions.roleToAssume) {
    return [
      {
        name: "Configure AWS Credentials",
        uses: "aws-actions/configure-aws-credentials@v6",
        with: {
          "aws-access-key-id": secretToString(
            parsedCodeArtifactOptions.accessKeyIdSecret,
          ),
          "aws-secret-access-key": secretToString(
            parsedCodeArtifactOptions.secretAccessKeySecret,
          ),
          "aws-region": "us-east-2",
          "role-to-assume": parsedCodeArtifactOptions.roleToAssume,
          "role-duration-seconds": 900,
        },
      },
      {
        name: "AWS CodeArtifact Login",
        run: `${executeProjenCommand} ca:login`,
      },
    ];
  }

  return [
    {
      name: "AWS CodeArtifact Login",
      run: `${executeProjenCommand} ca:login`,
      env: {
        AWS_ACCESS_KEY_ID: secretToString(
          parsedCodeArtifactOptions.accessKeyIdSecret,
        ),
        AWS_SECRET_ACCESS_KEY: secretToString(
          parsedCodeArtifactOptions.secretAccessKeySecret,
        ),
      },
    },
  ];
}
