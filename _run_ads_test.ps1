$ErrorActionPreference = 'Continue'
$root = 'd:\zinda play\zinda_play_node_react (1)'
Set-Location $root

# 1. Diffs versus HEAD
git --no-pager diff -- mobile/lib/ads.dart | Out-File -Encoding utf8 "$root\_d_ads.dart"
git --no-pager diff -- mobile/test/ads_test.dart | Out-File -Encoding utf8 "$root\_d_adstest.dart"

# 2. Run the ads test suite with a hard timeout
Set-Location "$root\mobile"
$out = "$root\_t_out.txt"
$err = "$root\_t_err.txt"
if (Test-Path $out) { Remove-Item $out -Force }
if (Test-Path $err) { Remove-Item $err -Force }

$p = Start-Process -FilePath 'flutter' -ArgumentList 'test','test/ads_test.dart','--reporter','expanded' `
     -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -NoNewWindow
$finished = $p.WaitForExit(600000)
if (-not $finished) {
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  Get-Process -Name 'flutter_tester' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Add-Content $out "`n### TIMEOUT_KILLED after 600s ###"
} else {
  Add-Content $out "`n### EXIT_CODE=$($p.ExitCode) ###"
}
Write-Host "SCRIPT_DONE"
