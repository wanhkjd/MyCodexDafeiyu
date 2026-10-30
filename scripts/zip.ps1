$ErrorActionPreference = 'Stop'
Compress-Archive -LiteralPath $env:PET_ZIP_SOURCE -DestinationPath $env:PET_ZIP_TARGET -CompressionLevel Optimal -Force
