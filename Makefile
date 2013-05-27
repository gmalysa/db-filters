# Because nodeunit has structural problems, you have to copy coverage.js into the nodeunit reporters installed
# folder, which is generally /usr/lib/node_modules/nodeunit/lib/reporters. The reporter path is given relative
# to where the executable runs from in nodeunit/bin, because nodeunit has no interest in fixing paths for you.
#

SHELL=/bin/sh

all : test

# You need node-jscoverage installed, or this will produce an error. That can be accomplished with:
# git clone https://github.com/visionmedia/node-jscoverage.git
# ./configure && make && make install
# Then, you'll be able to do `make coverage`
coverage :
	rm -rf lib-cov
	jscoverage lib lib-cov

# Copy ./coverage.js to <<nodeunit install path>>/lib/reporters
test : coverage
	nodeunit --reporter ../lib/reporters/coverage test

# View the annotated source output via less to parse the ansi escape codes properly
annotate : test
	less -r annotated/*
