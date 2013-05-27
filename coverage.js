/*!
 * Modified version of the default reporter to print code coverage from jscoverage
 * based on https://github.com/arunoda/nodeunit/commit/2bf99117a6df9ace410c57d7225fe82ea2e48fac
 * which is not included in any of the default reporters
 *
 * Nodeunit
 * Copyright (c) 2010 Caolan McMahon
 * MIT Licensed
 */

/**
 * Module dependencies
 */

var nodeunit = require('../nodeunit'),
    utils = require('../utils'),
    fs = require('fs'),
    track = require('../track'),
    path = require('path'),
    AssertionError = require('../assert').AssertionError;

/**
 * Reporter info string
 */

exports.info = "Default+coverage test reporter";


/**
 * Run all tests within each module, reporting the results to the command-line.
 *
 * @param {Array} files
 * @api public
 */

exports.run = function (files, options, callback) {

    if (!options) {
        // load default options
        var content = fs.readFileSync(
            __dirname + '/../../bin/nodeunit.json', 'utf8'
        );
        options = JSON.parse(content);
    }

    var error = function (str) {
        return options.error_prefix + str + options.error_suffix;
    };
    var ok    = function (str) {
        return options.ok_prefix + str + options.ok_suffix;
    };
    var bold  = function (str) {
        return options.bold_prefix + str + options.bold_suffix;
    };
    var assertion_message = function (str) {
        return options.assertion_prefix + str + options.assertion_suffix;
    };

    var start = new Date().getTime();
    var tracker = track.createTracker(function (tracker) {
        if (tracker.unfinished()) {
            console.log('');
            console.log(error(bold(
                'FAILURES: Undone tests (or their setups/teardowns): '
            )));
            var names = tracker.names();
            for (var i = 0; i < names.length; i += 1) {
                console.log('- ' + names[i]);
            }
            console.log('');
            console.log('To fix this, make sure all tests call test.done()');
            process.reallyExit(tracker.unfinished());
        }
    });

	var opts = {
	    testspec: options.testspec,
	    testFullSpec: options.testFullSpec,
        moduleStart: function (name) {
            console.log('\n' + bold(name));
        },
        testDone: function (name, assertions) {
            tracker.remove(name);

            if (!assertions.failures()) {
                console.log('✔ ' + name);
            }
            else {
                console.log(error('✖ ' + name) + '\n');
                assertions.forEach(function (a) {
                    if (a.failed()) {
                        a = utils.betterErrors(a);
                        if (a.error instanceof AssertionError && a.message) {
                            console.log(
                                'Assertion Message: ' +
                                assertion_message(a.message)
                            );
                        }
                        console.log(a.error.stack + '\n');
                    }
                });
            }
        },
        done: function (assertions, end) {
            var end = end || new Date().getTime();
            var duration = end - start;
            if (assertions.failures()) {
                console.log(
                    '\n' + bold(error('FAILURES: ')) + assertions.failures() +
                    '/' + assertions.length + ' assertions failed (' +
                    assertions.duration + 'ms)'
                );
            }
            else {
                console.log(
                   '\n' + bold(ok('OK: ')) + assertions.length +
                   ' assertions (' + assertions.duration + 'ms)'
                );
            }

			if (_$jscoverage !== undefined) {
				populateCoverage(_$jscoverage);
				reportCoverage(_$jscoverage);
			}

            if (callback) callback(assertions.failures() ? new Error('We have got test failures.') : undefined);
        },
        testStart: function(name) {
            tracker.put(name);
        }
    };
	if (files && files.length) {
	    var paths = files.map(function (p) {
	        return path.join(process.cwd(), p);
	    });
	    nodeunit.runFiles(paths, opts);
	} else {
		nodeunit.runModules(files,opts);
	}
};

/*
    Borrowed Code from Expresso
*/

var file_matcher = /\.js$/;

/**
 * Report test coverage.
 *
 * @param  {Object} cov
 */

function reportCoverage(cov) {
    // Stats
    print('\n   [bold]{Test Coverage}\n');
    var sep = '   +------------------------------------------+----------+------+------+--------+',
        lastSep = '                                              +----------+------+------+--------+';
	result = sep+'\n';
    result += '   | filename                                 | coverage | LOC  | SLOC | missed |\n';
    result += sep+'\n';
    for (var name in cov) {
        var file = cov[name];
        if (Array.isArray(file)) {
            result += '   | ' + rpad(name, 40);
            result += ' | ' + lpad(file.coverage.toFixed(2), 8);
            result += ' | ' + lpad(file.LOC, 4);
            result += ' | ' + lpad(file.SLOC, 4);
            result += ' | ' + lpad(file.totalMisses, 6);
            result += ' |\n';
        }
    }
    result += sep+'\n';
    result += '     ' + rpad('', 40);
    result += ' | ' + lpad(cov.coverage.toFixed(2), 8);
    result += ' | ' + lpad(cov.LOC, 4);
    result += ' | ' + lpad(cov.SLOC, 4);
    result += ' | ' + lpad(cov.totalMisses, 6);
    result += ' |\n';
    result += lastSep;
	console.log(result);

	for (var name in cov) {
		if (name.match(file_matcher)) {
			var file = cov[name];
			var annotated = '';
			annotated += colorize('\n  [bold]{' + name + '}:');
			annotated += colorize(file.source);
			annotated += '\n';
			fs.writeFileSync('annotated/'+name, annotated);
		}
	}
}

/**
 * Populate code coverage data.
 * @param  {Object} cov
 */

function populateCoverage(cov) {
    cov.LOC =
    cov.SLOC =
    cov.totalFiles =
    cov.totalHits =
    cov.totalMisses =
    cov.coverage = 0;
    for (var name in cov) {
        var file = cov[name];
        if (Array.isArray(file)) {
            // Stats
            ++cov.totalFiles;
            cov.totalHits += file.totalHits = coverage(file, true);
            cov.totalMisses += file.totalMisses = coverage(file, false);
            file.totalLines = file.totalHits + file.totalMisses;
            cov.SLOC += file.SLOC = file.totalLines;
            if (!file.source) file.source = [];
            cov.LOC += file.LOC = file.source.length;
            file.coverage = (file.totalHits / file.totalLines) * 100;
            // Source
            var width = file.source.length.toString().length;
            file.source = file.source.map(function(line, i){
                ++i;
                var hits = file[i] === 0 ? 0 : (file[i] || ' ');
                if (hits === 0) {
                    hits = '\x1b[31m' + hits + '\x1b[0m';
                    line = '\x1b[41m' + line + '\x1b[0m';
                } else {
                    hits = '\x1b[32m' + hits + '\x1b[0m';
                }
                return '\n     ' + lpad(i, width) + ' | ' + hits + ' | ' + line;
            }).join('');
        }
    }
    cov.coverage = (cov.totalHits / cov.SLOC) * 100;
}

/**
 * Total coverage for the given file data.
 *
 * @param  {Array} data
 * @return {Type}
 */

function coverage(data, val) {
    var n = 0;
    for (var i = 0, len = data.length; i < len; ++i) {
        if (data[i] !== undefined && data[i] == val) ++n;
    }
    return n;
}

/**
 * Test if all files have 100% coverage
 *
 * @param  {Object} cov
 * @return {Boolean}
 */

function hasFullCoverage(cov) {
  for (var name in cov) {
    var file = cov[name];
    if (file instanceof Array) {
      if (file.coverage !== 100) {
          return false;
      }
    }
  }
  return true;
}

/**
 * Pad the given string to the maximum width provided.
 *
 * @param  {String} str
 * @param  {Number} width
 * @return {String}
 */

function lpad(str, width) {
    str = String(str);
    var n = width - str.length;
    if (n < 1) return str;
    while (n--) str = ' ' + str;
    return str;
}

/**
 * Pad the given string to the maximum width provided.
 *
 * @param  {String} str
 * @param  {Number} width
 * @return {String}
 */

function rpad(str, width) {
    str = String(str);
    var n = width - str.length;
    if (n < 1) return str;
    while (n--) str = str + ' ';
    return str;
}

function print(str){
    console.log(colorize(str));
}

/**
 * Colorize the given string using ansi-escape sequences.
 * Disabled when --boring is set.
 *
 * @param {String} str
 * @return {String}
 */

function colorize(str){
    var colors = { bold: 1, red: 31, green: 32, yellow: 33 };
    return str.replace(/\[(\w+)\]\{([^]*?)\}/g, function(_, color, str){
        return '\x1B[' + colors[color] + 'm' + str + '\x1B[0m';
    });
}

function colorize_html(str) {
    var colors = { bold: 'bold', red: 'red', green: 'green', yellow: 'yellow' };
    return str.replace(/\[(\w+)\]\{([^]*?)\}/g, function(_, color, str){
		return '<span class="' + colors[color] + '">' + str + '</span>';
	});
}
