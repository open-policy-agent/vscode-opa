.PHONY: fmt
fmt:
	npx eslint . --fix
	npx dprint fmt

.PHONY: lint
lint:
	npx dprint check
	npx eslint --format @microsoft/eslint-formatter-sarif --output-file eslint-results.sarif .
	npx tsc --noEmit
	npx cspell lint -c cspell.config.yaml '**/*.md'
	npx markdownlint-cli2 'README.md' 'CHANGELOG.md' '#node_modules' --config=.markdownlint.yaml

.PHONY: build
build:
	npx tsc -p ./

.PHONY: clean
clean:
	rm -rf out/
	rm -f build.vsix
