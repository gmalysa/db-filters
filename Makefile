# Because nodeunit has structural problems, you have to copy coverage.js into the nodeunit reporters installed
# folder, which is generally /usr/lib/node_modules/nodeunit/lib/reporters. The reporter path is given relative
# to where the executable runs from in nodeunit/bin, because nodeunit has no interest in fixing paths for you.
#

SHELL=/bin/sh

coverage :
	rm -rf lib-cov
	jscoverage lib lib-cov

test : coverage
	nodeunit --reporter ../lib/reporters/coverage test

annotate : test
	less -r annotated/*
