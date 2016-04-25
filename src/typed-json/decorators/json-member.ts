﻿import {PropertyDecorator, ParameterlessConstructor} from "../types";
import {JsonMemberMetadata, JsonObjectMetadata} from "../json-metadata";
import * as Helpers from "../helpers";

declare abstract class Reflect {
    public static getMetadata(metadataKey: string, target: any, targetKey: string | symbol): any;
}

function duckTypeMetadataSetter<T>(value: any, propertyType: { new (): T }) {
    var metadata: JsonObjectMetadata<T>;

    if (!(value instanceof propertyType)) {
        // The value assigned to this @JsonMember property is not of the correct type, but properties match.
        // If the passed in value does not contain metadata information (but is an object), copy metadata.
        metadata = JsonObjectMetadata.getJsonObjectMetadataFromType<T>(propertyType);

        if (metadata) {
            value.__jsonTypesJsonObjectMetadataInformation__ = metadata;
        }
    }
}

export interface JsonMemberOptions<T> {
    /**
     * Sets the json member name. Default value is property key.
     */
    name?: string;

    /** 
     * Sets the json member type. The referenced type must contain a parameterless constructor.
     * *** Optional if reflect metadata is available. ***
     */
    type?: ParameterlessConstructor<T>;

    /** 
     * When the json member is an array, sets the type of array elements.
     * *** Required for array json members. ***
     */
    elementType?: ParameterlessConstructor<any>;

    /**
     * When set, indicates that the json member must be present when deserializing a JSON string.
     */
    isRequired?: boolean;

    /**
     * Sets the serialization/deserialization order of the json member.
     */
    order?: number;

    /**
     * When set, duck-type assignments to the property will automatically copy own metadata information corresponding to the property type.
     */
    duckTyping?: boolean;

    /**
     * When set, default values is emitted if the member is uninitialized.
     */
    emitDefaultValue?: boolean;
}

/**
 * When applied to the instance member (property) of a class, specifies that the member is part of a JsonObject and is (de)serializable.
 * *** Parameterless use requires reflect metadata to determine member type. ***
 */
export function JsonMember(): PropertyDecorator;

/**
 * When applied to the instance member (property) of a class, specifies that the member is part of a JsonObject and is (de)serializable.
 * *** The type setting is required unless reflect metadata is available. ***
 * *** The elementType setting is required for arrays. ***
 * @param options Configuration settings for the json member.
 */
export function JsonMember(options: JsonMemberOptions<any>): PropertyDecorator;

export function JsonMember(options?: JsonMemberOptions<any>): PropertyDecorator {
    var memberMetadata = new JsonMemberMetadata();

    options = options || {};

    if (options.hasOwnProperty("isRequired")) {
        memberMetadata.isRequired = options.isRequired;
    }

    if (options.hasOwnProperty("order")) {
        memberMetadata.order = options.order;
    }

    if (options.hasOwnProperty("type")) {
        memberMetadata.type = options.type;
    }

    if (options.hasOwnProperty("elementType")) {
        memberMetadata.elementType = options.elementType;
    }

    if (options.hasOwnProperty("emitDefaultValue")) {
        memberMetadata.emitDefaultValue = options.emitDefaultValue;
    }

    return function (target: any, propertyKey: string | symbol): void {
        var descriptor = Object.getOwnPropertyDescriptor(target, propertyKey.toString());;
        var originalSetter: Function;
        var objectMetadata: JsonObjectMetadata<any>;
        var parentMetadata: JsonObjectMetadata<any>;
        var reflectType: any;
        var propertyName = Helpers.getPropertyDisplayName(target, propertyKey);

        // Static members are not supported (when a property decorator is applied to a static member, target is the constructor function).
        if (typeof target === "function") {
            throw new TypeError(`@JsonMember cannot be used on a static property ('${propertyName}').`);
        }

        // Functions (methods) cannot be serialized.
        if (typeof target[propertyKey] === "function") {
            throw new TypeError(`@JsonMember cannot be used on a method ('${propertyName}').`);
        }

        memberMetadata.key = propertyKey.toString();
        memberMetadata.name = options.name || propertyKey.toString(); // Property key is used as default member name if not specified.

        // Check for reserved member names.
        if (Helpers.isReservedMemberName(memberMetadata.name)) {
            throw new Error(`@JsonMember: '${memberMetadata.name}' is a reserved name.`);
        }

        // It is a common error for types to exist at compile time, but not at runtime (often caused by improper/misbehaving imports).
        if (options.hasOwnProperty("type") && typeof options.type === "undefined") {
            throw new TypeError(`@JsonMember: 'type' of property '${propertyName}' is undefined.`);
        }

        // ... same for elementType.
        if (options.hasOwnProperty("elementType") && typeof options.elementType === "undefined") {
            throw new TypeError(`@JsonMember: 'elementType' of property '${propertyName}' is undefined.`);
        }

        //#region "Reflect Metadata support"
        if (typeof Reflect === "object" && typeof Reflect.getMetadata === "function") {
            reflectType = Reflect.getMetadata("design:type", target, propertyKey);

            if (typeof reflectType === "undefined") {
                // If Reflect.getMetadata exists, functionality for *setting* metadata should also exist, and metadata *should* be set.
                throw new TypeError(`@JsonMember: type detected for property '${propertyName}' is undefined.`);
            }

            if (!memberMetadata.type || typeof memberMetadata.type !== "function") {
                // Get type information using reflect metadata.
                memberMetadata.type = reflectType;
            } else if (memberMetadata.type !== reflectType && !Helpers.isSubtypeOf(memberMetadata.type, reflectType)) {
                Helpers.warn(`@JsonMember: 'type' specified for '${propertyName}' does not match detected type.`);
            }
        }
        //#endregion "Reflect Metadata support"

        // Ensure valid types have been specified ('type' at all times, 'elementType' for arrays).
        if (typeof memberMetadata.type !== "function") {
            throw new Error(`@JsonMember: no valid 'type' specified for property '${propertyName}'.`);
        } else if (memberMetadata.type === Array && typeof memberMetadata.elementType !== "function") {
            throw new Error(`@JsonMember: no valid 'elementType' specified for property '${propertyName}'.`);
        }

        // Add JsonObject metadata to 'target' if not yet exists (implicit @JsonObject, 'target' is the prototype).
        if (!target.hasOwnProperty("__jsonTypesJsonObjectMetadataInformation__")) {
            objectMetadata = new JsonObjectMetadata();

            // If applicable, inherit @JsonMembers from parent @JsonObject.
            if (parentMetadata = target.__jsonTypesJsonObjectMetadataInformation__) {
                // @JsonMembers
                Object.keys(parentMetadata.dataMembers).forEach(memberPropertyKey => {
                    objectMetadata.dataMembers[memberPropertyKey] = parentMetadata.dataMembers[memberPropertyKey];
                });
            }

            // 'target' is the prototype of the involved class (metadata information is added to the class prototype).
            Object.defineProperty(target, "__jsonTypesJsonObjectMetadataInformation__", {
                enumerable: false,
                configurable: false,
                writable: false,
                value: objectMetadata
            });
        } else {
            // JsonObjectMetadata already exists on target.
            objectMetadata = target.__jsonTypesJsonObjectMetadataInformation__;
        }
        
        if (options.duckTyping) {
            originalSetter = descriptor.set;

            // Add setter that will copy metadata information to value.
            if (originalSetter) {
                descriptor.set = function (value) {
                    duckTypeMetadataSetter(value, memberMetadata.type);
                    originalSetter.apply(this, arguments);
                }
            } else {
                descriptor.set = function (value) {
                    duckTypeMetadataSetter(value, memberMetadata.type);
                }
            }
        }

        // Automatically add known types.
        if (options.type) {
            objectMetadata.setKnownType(options.type);
        }

        if (options.elementType) {
            objectMetadata.setKnownType(options.elementType);
        }

        // Register @JsonMember with @JsonObject (will overwrite previous member when used multiple times on same property).
        try {
            objectMetadata.addMember(memberMetadata);
        } catch (e) {
            let className = Helpers.getClassName(objectMetadata.classType);
            throw new Error(`@JsonMember: member '${memberMetadata.name}' already exists on '${className}'.`);
        }
    };
}