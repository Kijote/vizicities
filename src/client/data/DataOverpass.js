/* globals window, _, VIZI, Q, d3 */
(function() {
	"use strict";

	VIZI.DataOverpass = function() {
		VIZI.Log("Inititialising building manager");

		VIZI.Data.call(this);

		this.query = "[out:json];" +
			"((" + 
			"rel({s},{w},{n},{e})[waterway~%22riverbank|dock%22];" +
			"rel({s},{w},{n},{e})[waterway=%22canal%22][area=%22yes%22];" +
			"rel({s},{w},{n},{e})[natural~%22water|scrub%22];" +
			"rel({s},{w},{n},{e})[leisure~%22park|pitch%22];" +
			"rel({s},{w},{n},{e})[landuse~%22grass|meadow|forest|commercial|retail|industrial|construction|brownfield%22];" +
			");(._;way(r););(._;node(w););(" +
			"way({s},{w},{n},{e})[%22building%22];" +
			"way({s},{w},{n},{e})[waterway~%22riverbank|dock%22];" +
			"way({s},{w},{n},{e})[waterway=%22canal%22][area=%22yes%22];" +
			"way({s},{w},{n},{e})[natural~%22water|scrub%22];" +
			"way({s},{w},{n},{e})[leisure~%22park|pitch%22];" +
			"way({s},{w},{n},{e})[landuse~%22grass|meadow|forest|commercial|retail|industrial|construction|brownfield%22];" +
			");(._;node(w);););out;";

		// URL of data source
		// Good Overpass queries: https://raw2.github.com/bigr/map1/master/import_osm.eu1000
		// this.url = "http://overpass-api.de/api/interpreter?data=[out:json];(way[%22building%22]({s},{w},{n},{e});node(w);way[%22building:part%22=%22yes%22]({s},{w},{n},{e});node(w);relation[%22building%22]({s},{w},{n},{e});way(r);node(w););out;";
		// this.url = "http://overpass-api.de/api/interpreter?data=[out:json];(way[%22building%22]({s},{w},{n},{e});node(w));out;";
		// this.url = "http://overpass.osm.rambler.ru/cgi/interpreter?data=[out:json];(way[%22building%22]({s},{w},{n},{e});node(w));out;";
		// this.url = "http://overpass.osm.rambler.ru/cgi/interpreter?data=[out:json];((rel({s},{w},{n},{e})[waterway~%22riverbank|dock%22];rel({s},{w},{n},{e})[waterway=%22canal%22][area=%22yes%22];rel({s},{w},{n},{e})[natural=%22water%22];);(._;way(r););(._;node(w););(way({s},{w},{n},{e})[waterway~%22riverbank|dock%22];way({s},{w},{n},{e})[waterway=%22canal%22][area=%22yes%22];way({s},{w},{n},{e})[natural=%22water%22];);(._;node(w);););out;";
		// this.url = "http://overpass-api.de/api/interpreter?data=[out:json];((rel({s},{w},{n},{e})[waterway~%22riverbank|dock%22];rel({s},{w},{n},{e})[waterway=%22canal%22][area=%22yes%22];rel({s},{w},{n},{e})[natural=%22water%22];);(._;way(r););(._;node(w););(way({s},{w},{n},{e})[waterway~%22riverbank|dock%22];way({s},{w},{n},{e})[waterway=%22canal%22][area=%22yes%22];way({s},{w},{n},{e})[natural=%22water%22];);(._;node(w);););out;";
		this.url = "http://overpass-api.de/api/interpreter?data=" + this.query;
	};

	VIZI.DataOverpass.prototype = Object.create( VIZI.Data.prototype );

	VIZI.DataOverpass.prototype.update = function() {
		var self = this;
		var deferred = Q.defer();

		// TODO: Perform the following for each tile, rather than for a single large area

		// TODO: Get bounds of area to retrieve data for
		// - Likely an event from the geo or controls class as the view is changed
		var bounds = self.geo.getBounds(self.geo.center, self.dataBoundsDistance);

		// TODO: Check cache for existing data

		self.load(bounds).then(function(data) {
			if (data.elements.length === 0) {
				deferred.reject(new Error("No buildings"));
			}

			var features = self.process(data);

			// TODO: Add data to cache
			// TODO: Send data to be rendered

			deferred.resolve(features);
		}, function(error) {
			deferred.reject(new Error(error));
		}).done();

		return deferred.promise;
	};

	// Process data (convert from Overpass format to a common ViziCities format)
	// http://wiki.openstreetmap.org/wiki/Talk:Overpass_API/Language_Guide#JSON_Syntax
	VIZI.DataOverpass.prototype.process = function(data) {
		var self = this;

		var nodes = {};
		var ways = [];

		var elements = data.elements;
		_.each(elements, function(element) {
			// Find a way to do this without passing the node and way objects
			switch (element.type) {
				case "node":
					self.processNode(nodes, element);
					break;
				case "way":
					self.processWay(nodes, ways, element);
					break;
			}
		});

		return ways;
	};

	VIZI.DataOverpass.prototype.processNode = function(nodes, element) {
		nodes[element.id] = this.geo.projection([element.lon, element.lat]);
	};

	VIZI.DataOverpass.prototype.processWay = function(nodes, ways, element) {
		var self = this;

		var points = element.nodes;
		var pointCount = points.length;

		var tags = element.tags;
		
		// Not enough points to make an object
		if (pointCount < 4) {
			return;
		}

		var coordinates = [];
		var dupe = false;
		_.each(points, function(point, index) {
			// Shouldn"t duplicate any points apart from first and last
			if (index < pointCount-1 && self.checkDuplicateCoords(coordinates, nodes[point])) {
				dupe = true;
			}

			coordinates.push(nodes[point]);
		});

		if (dupe) {
			VIZI.Log("Skipping feature as it has duplicate coordinates", coordinates);
			return;
		}

		tags.height = this.processHeight(tags);
		tags.colour = this.processColour(tags);

		ways.push({
			coordinates: coordinates,
			properties: tags
		});
	};

	VIZI.DataOverpass.prototype.processHeight = function(tags) {
		// Distance conversion
		// From: https://github.com/kekscom/osmbuildings/blob/master/src/Import.js#L39
		var height;
		var scalingFactor = (tags["building"] === "office") ? 1.45 : 1;
		if (tags.height) {
			height = this.toMeters(tags.height);
		} else if (!height && tags["building:height"]) {
			height = this.toMeters(tags["building:height"]);
		} else if (!height && tags.levels) {
			height = tags.levels * this.METERS_PER_LEVEL * scalingFactor <<0;
		} else if (!height && tags["building:levels"]) {
			height = tags["building:levels"] * this.METERS_PER_LEVEL * scalingFactor <<0;
		} else if (tags["building"]) {
			height = 10 + Math.random() * 10;
		} else if (tags["landuse"] === "forest") {
			height = 6;
		// } else if (tags["waterway"] || tags["natural"] && /water|scrub/.test(tags["natural"]) || tags["leisure"] && /park|pitch/.test(tags["leisure"]) || tags["landuse"] && /grass|meadow|commercial|retail|industrial|brownfield/.test(tags["landuse"])) {
		} else if (tags["waterway"] || tags["natural"] === "water") {
			height = 0.05;
		} else {
			height = 0.1;
		}

		return height;
	};

	VIZI.DataOverpass.prototype.processColour = function(tags) {
		var colour;
		if (tags["building"] || tags["building:part"]) {
			colour = 0xEEEEEE;
		} else if (tags["waterway"] || tags["natural"] === "water") {
			colour = 0x6DCCFF;
		} else if (tags["landuse"] === "forest") {
			colour = 0x7ea410;
		} else if (tags["natural"] === "scrub" || tags["leisure"] && /park|pitch/.test(tags["leisure"]) || tags["landuse"] && /grass|meadow/.test(tags["landuse"])) {
			colour = 0xc0da75;
		} else if (tags["landuse"] && /industrial|construction|brownfield/.test(tags["landuse"])) {
			colour = 0xd8c7b5;
		} else if (tags["landuse"] && /commercial|retail/.test(tags["landuse"])) {
			colour = 0xa9bbd6;
		} else {
			colour = 0xFF0000;
		}

		return colour;
	};
}());