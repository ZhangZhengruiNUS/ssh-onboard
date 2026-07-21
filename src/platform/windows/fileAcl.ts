import { lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { DomainError } from '../../core/domainError';
import type { ProcessRunner } from './processRunner';

export class WindowsFileAcl {
  public constructor(private readonly runner: ProcessRunner) {}

  public async restrictPrivateKey(filePath: string, createdByUs = false): Promise<void> {
    await this.restrict(filePath, false, false, createdByUs);
  }

  public async restrictDirectory(directoryPath: string): Promise<void> {
    await this.restrict(directoryPath, true);
  }

  public async ensureRestrictedDirectory(directoryPath: string): Promise<void> {
    await mkdir(path.dirname(directoryPath), { recursive: true });
    let createdByUs = false;
    try {
      await mkdir(directoryPath);
      createdByUs = true;
    } catch (error: unknown) {
      if (!isAlreadyExists(error)) {
        throw new DomainError('KEY_GENERATION_FAILED', 'directory-create');
      }
    }
    const stats = await lstat(directoryPath).catch(() => {
      throw new DomainError('KEY_GENERATION_FAILED', 'directory-stat');
    });
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new DomainError('KEY_GENERATION_FAILED', 'unsafe-directory');
    }
    await this.restrict(directoryPath, true, false, createdByUs);
  }

  public async assertDirectorySafe(directoryPath: string): Promise<void> {
    await this.restrict(directoryPath, true, true);
  }

  public async assertPrivateKeySafe(filePath: string): Promise<void> {
    await this.restrict(filePath, false, true);
  }

  private async restrict(
    targetPath: string,
    directory: boolean,
    checkOnly = false,
    createdByUs = false,
  ): Promise<void> {
    if (process.platform !== 'win32') {
      throw new DomainError('UNSUPPORTED_PLATFORM');
    }
    const script = [
      '$request = [Console]::In.ReadToEnd() | ConvertFrom-Json',
      '$target = [string]$request.target',
      '$mode = [string]$request.mode',
      '$createdByUs = [bool]$request.createdByUs',
      '$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()',
      '$current = $identity.User',
      "$system = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')",
      "$administrators = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')",
      '$principal = [System.Security.Principal.WindowsPrincipal]::new($identity)',
      '$isAdministratorsMember = $principal.IsInRole($administrators) -or ($identity.Groups.Value -contains $administrators.Value)',
      "$isDirectory = $mode -eq 'directory' -or $mode -eq 'check-directory'",
      "$checkOnly = $mode.StartsWith('check-')",
      '$existing = Get-Acl -LiteralPath $target -ErrorAction Stop',
      '$owner = ([System.Security.Principal.NTAccount]$existing.Owner).Translate([System.Security.Principal.SecurityIdentifier])',
      '$ownerIsCurrent = $owner.Value -eq $current.Value',
      '$ownerIsNormalizableAdministrators = $owner.Value -eq $administrators.Value -and $isAdministratorsMember',
      '$ownerIsNormalizable = $ownerIsNormalizableAdministrators -or $createdByUs',
      'if ($checkOnly -and -not $ownerIsCurrent) { exit 43 }',
      'if (-not $ownerIsCurrent -and -not $ownerIsNormalizable) { exit 43 }',
      '$allowed = @($current.Value, $system.Value)',
      '$expectedInheritance = if ($isDirectory) { [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit } else { [System.Security.AccessControl.InheritanceFlags]::None }',
      '$existingBad = @($existing.Access | Where-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -notin $allowed -or $_.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or $_.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl -or $_.InheritanceFlags -ne $expectedInheritance -or $_.PropagationFlags -ne [System.Security.AccessControl.PropagationFlags]::None })',
      '$existingSids = @($existing.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } | Sort-Object -Unique)',
      '$existingExact = $existing.AreAccessRulesProtected -and $existing.Access.Count -eq 2 -and $existingBad.Count -eq 0 -and $existingSids.Count -eq 2 -and $current.Value -in $existingSids -and $system.Value -in $existingSids',
      'if ($checkOnly) { if (-not $existingExact) { exit 42 }; exit 0 }',
      'if ($ownerIsCurrent -and $existingExact) { exit 0 }',
      '$acl = $existing',
      'if (-not $ownerIsCurrent) { $acl.SetOwner($current) }',
      "$dacl = if ($isDirectory) { 'D:P(A;OICI;FA;;;' + $current.Value + ')(A;OICI;FA;;;SY)' } else { 'D:P(A;;FA;;;' + $current.Value + ')(A;;FA;;;SY)' }",
      '$acl.SetSecurityDescriptorSddlForm($dacl, [System.Security.AccessControl.AccessControlSections]::Access)',
      'if ($isDirectory) { [System.IO.Directory]::SetAccessControl($target, $acl) } else { [System.IO.File]::SetAccessControl($target, $acl) }',
      '$actual = Get-Acl -LiteralPath $target -ErrorAction Stop',
      '$actualOwner = ([System.Security.Principal.NTAccount]$actual.Owner).Translate([System.Security.Principal.SecurityIdentifier])',
      'if ($actualOwner.Value -ne $current.Value) { exit 44 }',
      '$bad = @($actual.Access | Where-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -notin $allowed -or $_.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or $_.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl -or $_.InheritanceFlags -ne $expectedInheritance -or $_.PropagationFlags -ne [System.Security.AccessControl.PropagationFlags]::None })',
      '$actualSids = @($actual.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } | Sort-Object -Unique)',
      'if (-not $actual.AreAccessRulesProtected -or $actual.Access.Count -ne 2 -or $bad.Count -ne 0 -or $actualSids.Count -ne 2 -or $current.Value -notin $actualSids -or $system.Value -notin $actualSids) { exit 42 }',
    ].join('; ');
    const result = await this.runner.run({
      executable: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      nonSecretInput: JSON.stringify({
        target: targetPath,
        createdByUs,
        mode: checkOnly
          ? directory
            ? 'check-directory'
            : 'check-file'
          : directory
            ? 'directory'
            : 'file',
      }),
      timeoutMs: 15_000,
      errorCode: 'KEY_GENERATION_FAILED',
    });
    if (result.exitCode !== 0) {
      throw new DomainError('KEY_GENERATION_FAILED', `acl:${String(result.exitCode)}`);
    }
  }
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'EEXIST'
  );
}
