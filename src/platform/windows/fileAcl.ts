import { DomainError } from '../../core/domainError';
import type { ProcessRunner } from './processRunner';

export class WindowsFileAcl {
  public constructor(private readonly runner: ProcessRunner) {}

  public async restrictPrivateKey(filePath: string): Promise<void> {
    await this.restrict(filePath, false);
  }

  public async restrictDirectory(directoryPath: string): Promise<void> {
    await this.restrict(directoryPath, true);
  }

  public async assertPrivateKeySafe(filePath: string): Promise<void> {
    await this.restrict(filePath, false, true);
  }

  private async restrict(targetPath: string, directory: boolean, checkOnly = false): Promise<void> {
    if (process.platform !== 'win32') {
      throw new DomainError('UNSUPPORTED_PLATFORM');
    }
    const script = [
      '$request = [Console]::In.ReadToEnd() | ConvertFrom-Json',
      '$target = [string]$request.target',
      '$mode = [string]$request.mode',
      '$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User',
      "$system = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')",
      "$isDirectory = $mode -eq 'directory'",
      '$existing = Get-Acl -LiteralPath $target -ErrorAction Stop',
      '$owner = ([System.Security.Principal.NTAccount]$existing.Owner).Translate([System.Security.Principal.SecurityIdentifier])',
      'if ($owner.Value -ne $current.Value) { exit 43 }',
      '$allowed = @($current.Value, $system.Value)',
      "$existingBad = @($existing.Access | Where-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -notin $allowed -or $_.AccessControlType -ne 'Allow' -or ($_.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq 0 })",
      '$existingSids = @($existing.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } | Sort-Object -Unique)',
      "if ($mode -eq 'check-file') { if (-not $existing.AreAccessRulesProtected -or $existingBad.Count -ne 0 -or $current.Value -notin $existingSids) { exit 42 }; exit 0 }",
      'if ($existing.AreAccessRulesProtected -and $existingBad.Count -eq 0 -and $existingSids.Count -eq 2 -and $current.Value -in $existingSids -and $system.Value -in $existingSids) { exit 0 }',
      '$acl = $existing',
      "$dacl = if ($isDirectory) { 'D:P(A;OICI;FA;;;' + $current.Value + ')(A;OICI;FA;;;SY)' } else { 'D:P(A;;FA;;;' + $current.Value + ')(A;;FA;;;SY)' }",
      '$acl.SetSecurityDescriptorSddlForm($dacl, [System.Security.AccessControl.AccessControlSections]::Access)',
      'if ($isDirectory) { [System.IO.Directory]::SetAccessControl($target, $acl) } else { [System.IO.File]::SetAccessControl($target, $acl) }',
      '$actual = Get-Acl -LiteralPath $target -ErrorAction Stop',
      "$bad = @($actual.Access | Where-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -notin $allowed -or $_.AccessControlType -ne 'Allow' -or ($_.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq 0 })",
      'if ($bad.Count -ne 0) { exit 42 }',
    ].join('; ');
    const result = await this.runner.run({
      executable: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      nonSecretInput: JSON.stringify({
        target: targetPath,
        mode: checkOnly ? 'check-file' : directory ? 'directory' : 'file',
      }),
      timeoutMs: 15_000,
      errorCode: 'KEY_GENERATION_FAILED',
    });
    if (result.exitCode !== 0) {
      throw new DomainError('KEY_GENERATION_FAILED', `acl:${String(result.exitCode)}`);
    }
  }
}
