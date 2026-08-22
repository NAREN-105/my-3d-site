// THREE.GLTFLoader r128
THREE.GLTFLoader = ( function () {
	function GLTFLoader( manager ) {
		THREE.Loader.call( this, manager );
		this.dracoLoader = null;
		this.ktx2Loader = null;
		this.meshoptDecoder = null;
		this.pluginCallbacks = [];
		this.register( function ( parser ) { return new GLTFBinaryExtension( parser ); } );
		this.register( function ( parser ) { return new GLTFTextureTransformExtension( parser ); } );
		this.register( function ( parser ) { return new GLTFMaterialsLightmapExtension( parser ); } );
		this.register( function ( parser ) { return new GLTFMaterialsPBRSpecularGlossinessExtension( parser ); } );
		this.register( function ( parser ) { return new GLTFMaterialsClearcoatExtension( parser ); } );
		this.register( function ( parser ) { return new GLTFMaterialsTransmissionExtension( parser ); } );
		this.register( function ( parser ) { return new GLTFMaterialsRoughnessConeExtension( parser ); } );
	}
	GLTFLoader.prototype = Object.assign( Object.create( THREE.Loader.prototype ), {
		constructor: GLTFLoader,
		load: function ( url, onLoad, onProgress, onError ) {
			var scope = this;
			var resourcePath;
			if ( this.resourcePath !== '' ) { resourcePath = this.resourcePath; } else if ( this.path !== '' ) { resourcePath = this.path; } else { resourcePath = THREE.LoaderUtils.extractUrlBase( url ); }
			this.manager.itemStart( url );
			var _onError = function ( e ) { if ( onError ) { onError( e ); } else { console.error( e ); } scope.manager.itemError( url ); scope.manager.itemEnd( url ); };
			var loader = new THREE.FileLoader( this.manager );
			loader.setPath( this.path );
			loader.setResponseType( 'arraybuffer' );
			loader.setRequestHeader( this.requestHeader );
			loader.setWithCredentials( this.withCredentials );
			loader.load( url, function ( data ) { try { scope.parse( data, resourcePath, function ( gltf ) { onLoad( gltf ); scope.manager.itemEnd( url ); }, _onError ); } catch ( e ) { _onError( e ); } }, onProgress, _onError );
		},
		register: function ( callback ) { if ( this.pluginCallbacks.indexOf( callback ) === - 1 ) { this.pluginCallbacks.push( callback ); } return this; },
		unregister: function ( callback ) { var index = this.pluginCallbacks.indexOf( callback ); if ( index !== - 1 ) { this.pluginCallbacks.splice( index, 1 ); } return this; },
		parse: function ( data, path, onLoad, onError ) {
			var content;
			var extensions = {};
			var plugins = {};
			if ( typeof data === 'string' ) { content = data; } else {
				var magic = THREE.LoaderUtils.decodeText( new Uint8Array( data, 0, 4 ) );
				if ( magic === 'glTF' ) {
					try { extensions[ 'KHR_binary_glTF' ] = new GLTFBinaryExtension( data ); } catch ( error ) { if ( onError ) onError( error ); return; }
					content = extensions[ 'KHR_binary_glTF' ].content;
				} else { content = THREE.LoaderUtils.decodeText( new Uint8Array( data ) ); }
			}
			var json = JSON.parse( content );
			if ( json.asset === undefined || json.asset.version[ 0 ] < 2 ) { if ( onError ) onError( new Error( 'THREE.GLTFLoader: Unsupported asset version.' ) ); return; }
			var parser = new GLTFParser( json, { path: path || this.resourcePath || '', crossOrigin: this.crossOrigin, requestHeader: this.requestHeader, manager: this.manager, ktx2Loader: this.ktx2Loader, meshoptDecoder: this.meshoptDecoder } );
			parser.fileLoader.setWithCredentials( this.withCredentials );
			for ( var i = 0; i < this.pluginCallbacks.length; i ++ ) { var plugin = this.pluginCallbacks[ i ]( parser ); plugins[ plugin.name ] = plugin; parser.plugins[ plugin.name ] = plugin; }
			if ( json.extensionsUsed ) {
				for ( var i = 0; i < json.extensionsUsed.length; i ++ ) {
					var extensionName = json.extensionsUsed[ i ];
					var extensionsRequired = json.extensionsRequired || [];
					switch ( extensionName ) {
						case 'KHR_materials_unlit': parser.plugins[ extensionName ] = new GLTFMaterialsUnlitExtension( parser ); break;
						case 'KHR_materials_pbrSpecularGlossiness': parser.plugins[ extensionName ] = new GLTFMaterialsPBRSpecularGlossinessExtension( parser ); break;
						case 'KHR_texture_transform': parser.plugins[ extensionName ] = new GLTFTextureTransformExtension( parser ); break;
						default: if ( extensionsRequired.indexOf( extensionName ) >= 0 && plugins[ extensionName ] === undefined ) { console.warn( 'THREE.GLTFLoader: Unknown extension "' + extensionName + '".' ); }
					}
				}
			}
			parser.parse( onLoad, onError );
		}
	} );
	function GLTFParser( json, options ) {
		this.json = json || {};
		this.options = options || {};
		this.plugins = {};
		this.extensions = {};
		this.cache = new GLTFRegistry();
		this.associations = new Map();
		this.fileLoader = new THREE.FileLoader( this.options.manager );
		this.fileLoader.setPath( this.options.path );
		this.fileLoader.setResponseType( 'arraybuffer' );
		this.fileLoader.setRequestHeader( this.options.requestHeader );
		this.textureLoader = new THREE.TextureLoader( this.options.manager );
		this.textureLoader.setCrossOrigin( this.options.crossOrigin );
		this.textureLoader.setRequestHeader( this.options.requestHeader );
		this.imageLoader = new THREE.ImageLoader( this.options.manager );
		this.imageLoader.setCrossOrigin( this.options.crossOrigin );
		this.imageLoader.setRequestHeader( this.options.requestHeader );
	}
	GLTFParser.prototype.parse = function ( onLoad, onError ) {
		var parser = this;
		var json = this.json;
		this.cache.removeAll();
		this.markDefs();
		this.getDependencies( 'scene' ).then( function ( scenes ) {
			var result = { scene: scenes[ json.scene || 0 ], scenes: scenes, animations: [], cameras: [], asset: json.asset, parser: parser, userData: {} };
			addUnknownExtensionsToUserData( parser.plugins, result, json );
			onLoad( result );
		} ).catch( onError );
	};
	function GLTFRegistry() { var repository = {}; return { get: function ( name ) { return repository[ name ]; }, add: function ( name, promise ) { repository[ name ] = promise; }, remove: function ( name ) { delete repository[ name ]; }, removeAll: function () { repository = {}; } }; }
	function GLTFBinaryExtension( data ) {
		this.name = 'KHR_binary_glTF';
		this.content = null;
		this.body = null;
		var headerView = new DataView( data, 0, 12 );
		if ( headerView.getUint32( 4, true ) !== 2 ) { throw new Error( 'THREE.GLTFLoader: Unsupported binary format version.' ); }
		var chunkView = new DataView( data, 12 );
		var chunkIndex = 0;
		while ( chunkIndex < chunkView.byteLength ) {
			var chunkLength = chunkView.getUint32( chunkIndex, true );
			var chunkType = chunkView.getUint32( chunkIndex + 4, true );
			chunkIndex += 8;
			if ( chunkType === 0x4E4F534A ) {
				var chunkData = new Uint8Array( data, 12 + chunkIndex, chunkLength );
				this.content = THREE.LoaderUtils.decodeText( chunkData );
			} else if ( chunkType === 0x004E4942 ) {
				this.body = data.slice( 12 + chunkIndex, 12 + chunkIndex + chunkLength );
			}
			chunkIndex += chunkLength;
		}
		if ( this.content === null ) { throw new Error( 'THREE.GLTFLoader: Binary glTF has no JSON chunk.' ); }
	}
	function GLTFTextureTransformExtension() { this.name = 'KHR_texture_transform'; }
	function GLTFMaterialsLightmapExtension() { this.name = '3D_lightmap'; }
	function GLTFMaterialsPBRSpecularGlossinessExtension() { this.name = 'KHR_materials_pbrSpecularGlossiness'; }
	function GLTFMaterialsClearcoatExtension() { this.name = 'KHR_materials_clearcoat'; }
	function GLTFMaterialsTransmissionExtension() { this.name = 'KHR_materials_transmission'; }
	function GLTFMaterialsRoughnessConeExtension() { this.name = 'KHR_materials_roughnessCone'; }
	function GLTFMaterialsUnlitExtension() { this.name = 'KHR_materials_unlit'; }
	function addUnknownExtensionsToUserData( val, obj, json ) { for ( var key in val ) { if ( obj.userData[ key ] === undefined ) obj.userData[ key ] = val[ key ]; } }
	GLTFParser.prototype.markDefs = function () {};
	GLTFParser.prototype.getDependencies = function ( type ) {
		var parser = this;
		var defs = this.json[ type + 's' ] || [];
		var promise = this.cache.get( type );
		if ( ! promise ) {
			var promises = [];
			for ( var i = 0, il = defs.length; i < il; i ++ ) { promises.push( parser.getDependency( type, i ) ); }
			promise = Promise.all( promises );
			this.cache.add( type, promise );
		}
		return promise;
	};
	GLTFParser.prototype.getDependency = function ( type, index ) {
		var parser = this;
		var cacheKey = type + ':' + index;
		var promise = this.cache.get( cacheKey );
		if ( ! promise ) {
			switch ( type ) {
				case 'scene': promise = parser.loadScene( index ); break;
				case 'node': promise = parser.loadNode( index ); break;
				case 'mesh': promise = parser.loadMesh( index ); break;
				case 'material': promise = parser.loadMaterial( index ); break;
				case 'texture': promise = parser.loadTexture( index ); break;
				case 'image': promise = parser.loadImage( index ); break;
				default: promise = Promise.resolve( null );
			}
			this.cache.add( cacheKey, promise );
		}
		return promise;
	};
	GLTFParser.prototype.loadScene = function ( sceneIndex ) {
		var json = this.json;
		var sceneDef = json.scenes[ sceneIndex ];
		var parser = this;
		var scene = new THREE.Group();
		if ( sceneDef.name ) scene.name = sceneDef.name;
		if ( sceneDef.userData ) scene.userData = sceneDef.userData;
		var nodeIds = sceneDef.nodes || [];
		var promises = [];
		for ( var i = 0, il = nodeIds.length; i < il; i ++ ) { promises.push( parser.getDependency( 'node', nodeIds[ i ] ) ); }
		return Promise.all( promises ).then( function ( nodes ) { for ( var i = 0; i < nodes.length; i ++ ) { scene.add( nodes[ i ] ); } return scene; } );
	};
	GLTFParser.prototype.loadNode = function ( nodeIndex ) {
		var json = this.json;
		var nodeDef = json.nodes[ nodeIndex ];
		var parser = this;
		var node;
		if ( nodeDef.isBone ) { node = new THREE.Bone(); } else if ( nodeDef.mesh !== undefined ) {
			node = new THREE.Group();
		} else { node = new THREE.Object3D(); }
